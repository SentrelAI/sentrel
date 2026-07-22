require "net/http"
require "json"

# Spawns / destroys a machine per agent. Routes to a provider-specific backend
# based on the AGENT_PROVISIONER env var. Backends:
#
#   fly       — Fly Machines API (recommended; see docs/per-agent-hosting.md)
#   hetzner   — Hetzner Cloud API (cheaper at scale, slower boot)
#   local     — docker compose on this box (dev; great for smoke tests)
#
# The provisioner owns the agent_instances row for its lifecycle — create,
# status transitions, destroy. Rails controllers call ::provision_for(agent)
# after create, and ::terminate_for(agent) in destroy.
#
# Runs synchronously by default for simplicity. Swap to Sidekiq once spawns
# get slow (Hetzner is ~60s; user shouldn't block on that).

module AgentProvisioner
  module_function

  def backend
    case ENV["AGENT_PROVISIONER"]
    when "fly"     then FlyBackend
    when "hetzner" then HetznerBackend
    when "local"   then LocalBackend
    when nil, ""   then NullBackend   # no-op when unconfigured (dev default)
    else raise "Unknown AGENT_PROVISIONER=#{ENV['AGENT_PROVISIONER']}"
    end
  end

  # Create + start a machine for this agent. Creates the agent_instances row
  # in `provisioning`; backend flips it to `running` when healthy.
  def provision_for(agent)
    return if backend == NullBackend
    instance = agent.instance || agent.create_instance(
      status: "pending",
      provider: backend_name,
      machine_type: default_machine_type,
    )
    instance.update!(status: "provisioning", provisioning_error: nil)
    backend.create(agent, instance)
    instance
  rescue => e
    instance&.update(status: "failed", provisioning_error: e.message)
    Rails.logger.error "AgentProvisioner.provision_for(#{agent.id}) failed: #{e.class}: #{e.message}"
    nil
  end

  def terminate_for(agent)
    return if backend == NullBackend
    instance = agent.instance
    return unless instance
    # Don't early-return on missing machine_id. A half-provisioned agent
    # (Fly app created, machine creation failed) leaves an orphan app
    # that consumes a slot in the org's quota. We need to tear down the
    # app even when no machine ever attached. backend.destroy handles
    # both the (optional) machine destroy and the app destroy.
    backend.destroy(instance)
    instance.update!(status: "terminated", stopped_at: Time.current)
  rescue => e
    Rails.logger.warn "AgentProvisioner.terminate_for(#{agent.id}) failed: #{e.message}"
  end

  def backend_name
    case backend
    when FlyBackend     then "fly"
    when HetznerBackend then "hetzner"
    when LocalBackend   then "local"
    else                     "local"
    end
  end

  def default_machine_type
    case backend
    when FlyBackend     then "shared-cpu-1x"
    when HetznerBackend then "cax11"
    else                     "docker-compose"
    end
  end

  # ────────────────────────────────────────────────────────────────────────
  # Null backend — when no provisioner is configured. Makes provision_for /
  # terminate_for no-ops so dev works without Fly creds.
  # ────────────────────────────────────────────────────────────────────────
  module NullBackend
    module_function
    def create(*); end
    def destroy(*); end
  end

  # ────────────────────────────────────────────────────────────────────────
  # Fly.io backend — Machines API. Primary backend.
  # ────────────────────────────────────────────────────────────────────────
  module FlyBackend
    module_function

    def create(agent, instance)
      app_name = fly_app_name(agent)
      region   = ENV.fetch("FLY_REGION", "lax")
      ensure_app!(app_name)
      volume_id = ensure_volume!(app_name, region)

      body = {
        name: "agent-#{agent.id}",
        region: region,
        config: {
          image: EngineImage.current,
          env: env_for(agent),
          services: [ {
            ports: [ { port: 443, handlers: [ "tls", "http" ] },
                    { port: 80,  handlers: [ "http" ] } ],
            protocol: "tcp",
            internal_port: 3300,
            auto_stop_machines: "stop",
            auto_start_machines: true
          } ],
          mounts: [ { volume: volume_id, path: "/data" } ],
          # 4GB on a shared-cpu-2x. Bun engine alone uses ~500MB; the
          # @huggingface/transformers tool-embedding model adds ~300MB; +
          # whatever the agent runs (Node + npm + Puppeteer + Chrome
          # download for video-render workflows is the big one, ~1.5GB
          # spike). 2GB was OOM'ing on heavy Bash work — kernel killed
          # Node at runtime. 4GB gives ~1.5GB headroom for the agent's
          # own tool calls. 2 CPUs because we now have Bun engine + Node
          # subprocess + Chrome all competing.
          guest: { cpus: 2, memory_mb: 4096, cpu_kind: "shared" },
          # Scale-to-zero: the engine exits 0 after sitting idle (see engine
          # idle-stop). on-failure restarts crashes but lets that clean exit
          # actually stop the machine — the default policy would boot it
          # right back up and the fleet would never sleep.
          restart: { policy: "on-failure", max_retries: 3 }
        }
      }
      res = fly_api(:post, "/apps/#{app_name}/machines", body)
      machine_id = res["id"] || raise("Fly create returned no id: #{res.inspect}")

      instance.update!(
        status: "running",
        machine_id: machine_id,
        public_ip: res.dig("private_ip"),  # Fly surfaces the 6PN addr here
        started_at: Time.current,
      )
    end

    def destroy(instance)
      app_name = fly_app_name(instance.agent)

      # Best-effort machine destroy first — if there IS a machine_id,
      # tear it down. Then tear down the app itself. Apps that linger
      # after the agent is deleted consume an app-slot in the org's
      # quota even if they have no machines.
      if instance.machine_id.present?
        begin
          fly_api(:delete, "/apps/#{app_name}/machines/#{instance.machine_id}?force=true")
        rescue ApiNotFound
          # Machine already gone — fine, proceed to app cleanup.
        end
      end

      # Destroy the app. 404 means it was already gone — also fine.
      begin
        fly_api(:delete, "/apps/#{app_name}")
      rescue ApiNotFound
        # Nothing to clean up.
      end
    end

    def fly_app_name(agent)
      # One Fly App per agent so each gets its own DNS + scale-to-zero clock.
      # Env prefix keeps dev / staging / prod agents separate on the same
      # Fly org — e.g. alchemy-dev-agent-7 vs alchemy-prod-agent-7.
      env = ENV.fetch("DEPLOY_ENV", Rails.env == "production" ? "prod" : "dev")
      "alchemy-#{env}-agent-#{agent.id}"
    end

    def env_for(agent)
      # Provider routing for the Claude Agent SDK. Four supported providers:
      #
      #   anthropic          — direct API key (ANTHROPIC_API_KEY env)
      #   openrouter         — API key, routed through OR with the three
      #                        ANTHROPIC_DEFAULT_*_MODEL tier vars (the SDK
      #                        rejects non-Claude slugs otherwise).
      #   anthropic_account  — user's Pro/Max/Team subscription via OAuth.
      #                        Engine talks to a localhost billing proxy that
      #                        injects the Claude Code identifier header so
      #                        billing routes to the right pool. Token swap
      #                        + refresh are managed by RefreshOauthTokensJob.
      #   openai_account     — user's ChatGPT Plus/Pro/Business via OAuth.
      #                        Engine talks to a localhost translator proxy
      #                        that converts Anthropic Messages ↔ OpenAI
      #                        Responses so the SDK still works.
      #
      # AI-provider OAuth credentials live in oauth_credentials (kind=
      # "ai_provider") — never exposed to agents as MCP tools.
      provider = agent.ai_config&.provider.to_s
      model_id = agent.ai_config&.model_id.to_s

      env = {
        "EMPLOYEE_ID"         => agent.id.to_s,
        "DATABASE_URL"        => ENV.fetch("ENGINE_DATABASE_URL", ENV["DATABASE_URL"].to_s),
        "REDIS_URL"           => ENV.fetch("ENGINE_REDIS_URL", ENV["REDIS_URL"].to_s),
        "ENGINE_API_SECRET"   => ENV["ENGINE_API_SECRET"].to_s,
        "RAILS_INTERNAL_URL"  => ENV["RAILS_INTERNAL_URL"].to_s,
        # Public-facing URL the agent should use when constructing user-
        # facing links (download URLs from share_file, etc.). Falls back to
        # RAILS_INTERNAL_URL when not set explicitly.
        "WEBHOOK_BASE_URL"    => ENV["WEBHOOK_BASE_URL"].presence || ENV["RAILS_INTERNAL_URL"].to_s,
        # Scale-to-zero: minutes of no jobs/chat before the engine exits and
        # the machine stops (wakes on demand). "0" disables self-stop.
        "IDLE_STOP_MINUTES"   => ENV.fetch("IDLE_STOP_MINUTES", "20"),
        # BYO LLM keys — Credential.find_for(agent, …) prefers the org's
        # stored key over the platform-wide ENV fallback so customers can
        # bill against their own account. Same lookup for openai (for
        # transcribe / embed).
        "OPENAI_API_KEY"      => byo_key(agent, "openai", ENV["OPENAI_API_KEY"]),
        "SENTRY_DSN"          => ENV["SENTRY_DSN"].to_s,
        # "all" loads every connected integration's tools into allowedTools
        # at session start, so tools discovered via search_integrations
        # actually execute. "smart" (the old default) silently dropped
        # dynamically-loaded tool calls because allowedTools didn't grow
        # with setMcpServers.
        "TOOL_ROUTING"        => "all",
        "RESUME_ENABLED"      => "true",
        # Extended-thinking budget — engine maps low/medium/high to
        # 2000/4000/8000 tokens, "none" disables. Toggled per-agent via
        # ai_config.thinking_level in the edit UI.
        "ENGINE_THINKING_LEVEL" => agent.ai_config&.thinking_level.to_s.presence || "none"
      }

      case provider
      when "openrouter"
        openrouter_key = byo_key(agent, "openrouter", ENV["OPENROUTER_API_KEY"])
        if openrouter_key.present?
          env["ANTHROPIC_BASE_URL"]             = "https://openrouter.ai/api"
          env["ANTHROPIC_AUTH_TOKEN"]           = openrouter_key
          env["ANTHROPIC_API_KEY"]              = ""
          env["ANTHROPIC_DEFAULT_HAIKU_MODEL"]  = model_id
          env["ANTHROPIC_DEFAULT_SONNET_MODEL"] = model_id
          env["ANTHROPIC_DEFAULT_OPUS_MODEL"]   = model_id
        end
      when "anthropic_account"
        cred = ai_provider_credential(agent.organization_id, "anthropic")
        token = credential_token(cred)
        if token.present?
          # Engine starts an in-process billing proxy on this port (see
          # alchemy_engine/src/proxy/anthropic-billing-proxy.ts). Proxy reads
          # ANTHROPIC_OAUTH_TOKEN from env, injects the Claude Code identifier
          # header, forwards to api.anthropic.com.
          #
          # ANTHROPIC_AUTH_TOKEN is the Claude Agent SDK's official env var for
          # OAuth tokens — without it, the SDK refuses to make any requests and
          # emits "Not logged in · Please run /login" before they ever hit our
          # proxy. Set both: SDK uses ANTHROPIC_AUTH_TOKEN to authenticate at
          # the client layer, the proxy uses ANTHROPIC_OAUTH_TOKEN to re-stamp
          # the authorization header on outbound requests to api.anthropic.com.
          env["ANTHROPIC_BASE_URL"]    = "http://127.0.0.1:18801"
          env["ANTHROPIC_AUTH_TOKEN"]  = token
          env["ANTHROPIC_OAUTH_TOKEN"] = token
          env["ANTHROPIC_API_KEY"]     = ""
        end
      when "openai_account"
        cred = ai_provider_credential(agent.organization_id, "openai")
        token = credential_token(cred)
        if token.present?
          # Engine starts a translator proxy that accepts Anthropic Messages
          # shape and forwards to api.openai.com/v1/responses with the OAuth
          # token. See alchemy_engine/src/proxy/openai-translator-proxy.ts.
          env["ANTHROPIC_BASE_URL"]              = "http://127.0.0.1:18802"
          env["OPENAI_OAUTH_TOKEN"]              = token
          env["OPENAI_ACCOUNT_ID"]               = cred.account_id.to_s
          env["ANTHROPIC_API_KEY"]               = ""
          env["ANTHROPIC_DEFAULT_HAIKU_MODEL"]   = model_id
          env["ANTHROPIC_DEFAULT_SONNET_MODEL"]  = model_id
          env["ANTHROPIC_DEFAULT_OPUS_MODEL"]    = model_id
        end
      else
        env["ANTHROPIC_API_KEY"] = byo_key(agent, "anthropic", ENV["ANTHROPIC_API_KEY"])
      end

      env.compact
    end

    # Prefer the org's stored llm_api_key for `provider`; fall back to the
    # platform-wide ENV value (so existing deployments without any custom
    # credentials keep working). Returns "" instead of nil so env.compact
    # doesn't drop "I'm deliberately blanking this" overrides.
    def byo_key(agent, provider, fallback)
      cred = Credential.find_for(agent, provider: provider, kind: "llm_api_key") rescue nil
      key = cred&.value.presence || fallback.to_s
      cred&.use! if cred && key.present?
      key
    end

    def ai_provider_credential(org_id, provider)
      ActsAsTenant.without_tenant do
        OauthCredential.find_by(organization_id: org_id, provider: provider, kind: "ai_provider")
      end
    end

    def credential_token(cred)
      cred&.access_token.to_s.strip.sub(/\ABearer[[:space:]]+/i, "").gsub(/[[:space:]]+/, "")
    end

    def ensure_app!(app_name)
      fly_api(:get, "/apps/#{app_name}")
    rescue ApiNotFound
      fly_api(:post, "/apps", { app_name: app_name, org_slug: ENV.fetch("FLY_ORG_SLUG") })
      # Allocate a free shared IPv4 so Rails can POST /sync over HTTPS and
      # wake the Machine on cold start. One-time per app.
      fly_api(:post, "/apps/#{app_name}/ips", { type: "shared_v4" }) rescue nil
    end

    # Fly requires a pre-created volume referenced by ID in the machine
    # create payload. Reuse an existing `alchemy_data` volume in the region
    # so multiple restarts of the same agent keep the same /data contents.
    def ensure_volume!(app_name, region)
      volumes = fly_api(:get, "/apps/#{app_name}/volumes")
      existing = Array(volumes).find { |v| v["name"] == "alchemy_data" && v["region"] == region }
      return existing["id"] if existing

      created = fly_api(:post, "/apps/#{app_name}/volumes", {
        name: "alchemy_data",
        region: region,
        size_gb: 10
      })
      created["id"] || raise("Fly volume create returned no id: #{created.inspect}")
    end

    def fly_api(method, path, body = nil)
      token = ENV.fetch("FLY_API_TOKEN") { raise "FLY_API_TOKEN required" }
      uri = URI.parse("https://api.machines.dev/v1#{path}")
      req =
        case method
        when :get    then Net::HTTP::Get.new(uri)
        when :post   then Net::HTTP::Post.new(uri)
        when :delete then Net::HTTP::Delete.new(uri)
        end
      req["Authorization"] = "Bearer #{token}"
      req["Content-Type"]  = "application/json"
      req.body = body.to_json if body
      res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, read_timeout: 30, open_timeout: 5) { |http| http.request(req) }
      raise ApiNotFound if res.code == "404"
      raise "Fly API #{method} #{path} failed (HTTP #{res.code}): #{res.body[0..300]}" unless res.is_a?(Net::HTTPSuccess)
      res.body.present? ? JSON.parse(res.body) : {}
    end

    class ApiNotFound < StandardError; end
  end

  # ────────────────────────────────────────────────────────────────────────
  # Hetzner Cloud backend — reference implementation for bare-VM providers.
  # Uses cloud-init.sh from the engine repo to bootstrap.
  # ────────────────────────────────────────────────────────────────────────
  module HetznerBackend
    module_function

    def create(agent, instance)
      token = ENV.fetch("HETZNER_API_TOKEN") { raise "HETZNER_API_TOKEN required" }
      server_type = ENV.fetch("HETZNER_SERVER_TYPE", "cax11")
      location    = ENV.fetch("HETZNER_LOCATION",    "nbg1")

      user_data = render_cloud_init(agent)
      body = {
        name: "alchemy-agent-#{agent.id}",
        server_type: server_type,
        image: "debian-12",
        location: location,
        user_data: user_data,
        labels: { "agent_id" => agent.id.to_s }
      }

      res = hetzner_api(:post, "/servers", body, token)
      server = res["server"] || raise("Hetzner create returned no server: #{res.inspect}")
      instance.update!(
        status: "provisioning",
        machine_id: server["id"].to_s,
        public_ip: server.dig("public_net", "ipv4", "ip"),
        started_at: Time.current,
      )
      # Engine flips `running` status itself when it posts to
      # /api/agent_instances/ready after cloud-init finishes.
    end

    def destroy(instance)
      token = ENV.fetch("HETZNER_API_TOKEN")
      hetzner_api(:delete, "/servers/#{instance.machine_id}", nil, token)
    end

    def render_cloud_init(agent)
      template = File.read(engine_cloud_init_path)
      # Provisioner substitutes required placeholders with real values.
      subs = {
        "${EMPLOYEE_ID}"       => agent.id.to_s,
        "${DATABASE_URL}"      => ENV["ENGINE_DATABASE_URL"].to_s,
        "${REDIS_URL}"         => ENV["ENGINE_REDIS_URL"].to_s,
        "${ANTHROPIC_API_KEY}" => ENV["ANTHROPIC_API_KEY"].to_s,
        "${ENGINE_API_SECRET}" => ENV["ENGINE_API_SECRET"].to_s,
        "${RAILS_INTERNAL_URL}"=> ENV["RAILS_INTERNAL_URL"].to_s,
        "${OPENAI_API_KEY:-}"  => ENV["OPENAI_API_KEY"].to_s
      }
      subs.each { |k, v| template = template.gsub(k, v) }
      template
    end

    def engine_cloud_init_path
      # In a monorepo deploy the engine repo is a sibling directory. Override
      # with ENGINE_CLOUD_INIT_PATH if layout differs.
      ENV.fetch("ENGINE_CLOUD_INIT_PATH", Rails.root.join("..", "alchemy_engine", "cloud-init.sh").to_s)
    end

    def hetzner_api(method, path, body, token)
      uri = URI.parse("https://api.hetzner.cloud/v1#{path}")
      req =
        case method
        when :get    then Net::HTTP::Get.new(uri)
        when :post   then Net::HTTP::Post.new(uri)
        when :delete then Net::HTTP::Delete.new(uri)
        end
      req["Authorization"] = "Bearer #{token}"
      req["Content-Type"]  = "application/json"
      req.body = body.to_json if body
      res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, read_timeout: 30, open_timeout: 5) { |http| http.request(req) }
      raise "Hetzner API #{method} #{path} failed (HTTP #{res.code}): #{res.body[0..300]}" unless res.is_a?(Net::HTTPSuccess)
      res.body.present? ? JSON.parse(res.body) : {}
    end
  end

  # ────────────────────────────────────────────────────────────────────────
  # Local backend — docker compose on this box. Useful for smoke testing
  # the Dockerfile without Fly creds. Runs one agent on the host.
  # ────────────────────────────────────────────────────────────────────────
  module LocalBackend
    module_function
    def create(agent, instance)
      Rails.logger.info "LocalBackend: would run `docker compose up -d` for agent #{agent.id} — noop in this stub"
      instance.update!(status: "running", machine_id: "local-#{agent.id}", started_at: Time.current)
    end

    def destroy(instance)
      Rails.logger.info "LocalBackend: would run `docker compose down` for instance #{instance.id} — noop in this stub"
    end
  end
end
