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
    return unless instance && instance.machine_id.present?
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
          image: ENV.fetch("ENGINE_IMAGE", "ghcr.io/parsedev/alchemy-engine:latest"),
          env: env_for(agent),
          services: [{
            ports: [{ port: 443, handlers: ["tls", "http"] },
                    { port: 80,  handlers: ["http"] }],
            protocol: "tcp",
            internal_port: 3300,
            auto_stop_machines: "stop",
            auto_start_machines: true,
          }],
          mounts: [{ volume: volume_id, path: "/data" }],
          guest: { cpus: 1, memory_mb: 2048, cpu_kind: "shared" },
        },
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
      fly_api(:delete, "/apps/#{app_name}/machines/#{instance.machine_id}?force=true")
    end

    def fly_app_name(agent)
      # One Fly App per agent so each gets its own DNS + scale-to-zero clock.
      # Env prefix keeps dev / staging / prod agents separate on the same
      # Fly org — e.g. alchemy-dev-agent-7 vs alchemy-prod-agent-7.
      env = ENV.fetch("DEPLOY_ENV", Rails.env == "production" ? "prod" : "dev")
      "alchemy-#{env}-agent-#{agent.id}"
    end

    def env_for(agent)
      {
        "EMPLOYEE_ID"         => agent.id.to_s,
        "DATABASE_URL"        => ENV.fetch("ENGINE_DATABASE_URL", ENV["DATABASE_URL"].to_s),
        "REDIS_URL"           => ENV.fetch("ENGINE_REDIS_URL", ENV["REDIS_URL"].to_s),
        "ANTHROPIC_API_KEY"   => ENV["ANTHROPIC_API_KEY"].to_s,
        "ENGINE_API_SECRET"   => ENV["ENGINE_API_SECRET"].to_s,
        "RAILS_INTERNAL_URL"  => ENV["RAILS_INTERNAL_URL"].to_s,
        "COMPOSIO_API_KEY"    => ENV["COMPOSIO_API_KEY"].to_s,
        "OPENAI_API_KEY"      => ENV["OPENAI_API_KEY"].to_s,
        "TOOL_ROUTING"        => "smart",
        "RESUME_ENABLED"      => "true",
      }.compact
    end

    def ensure_app!(app_name)
      fly_api(:get, "/apps/#{app_name}")
    rescue ApiNotFound
      fly_api(:post, "/apps", { app_name: app_name, org_slug: ENV.fetch("FLY_ORG_SLUG") })
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
        size_gb: 10,
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
        labels: { "agent_id" => agent.id.to_s },
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
        "${COMPOSIO_API_KEY:-}"=> ENV["COMPOSIO_API_KEY"].to_s,
        "${OPENAI_API_KEY:-}"  => ENV["OPENAI_API_KEY"].to_s,
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
