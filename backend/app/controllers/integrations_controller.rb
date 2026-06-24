class IntegrationsController < ApplicationController
  before_action :authenticate_user!

  # Locally enumerated so the controller can render even if the OauthCredential
  # constant fails to autoload (encryption-keys not configured yet, etc.).
  AI_PROVIDERS = %w[anthropic openai].freeze

  def index
    # Background-refresh the toolkit cache for this org — debounced to once
    # per 5 min. Runs as a Sidekiq job so the page render doesn't wait.
    cache_key = "composio:refresh_enq:org_#{current_tenant.id}"
    if ENV["COMPOSIO_API_KEY"].present? && Rails.cache.read(cache_key).blank?
      Rails.cache.write(cache_key, Time.current, expires_in: 5.minutes)
      RefreshComposioCacheJob.perform_later(current_tenant.id)
    end

    # Connection state sync (which auth tokens are active) is still per-user
    # because it touches Composio's connected_accounts endpoint. Debounced
    # to once per 60s per (org, user).
    sync_key = "composio:sync:org_#{current_tenant.id}:user_#{current_user.id}"
    if ENV["COMPOSIO_API_KEY"].present? && Rails.cache.read(sync_key).blank?
      Rails.cache.write(sync_key, Time.current, expires_in: 60.seconds)
      begin
        sync_composio_connections
      rescue => e
        Rails.logger.warn "sync_composio_connections skipped (#{e.class}: #{e.message})"
      end
    end

    # Subscription OAuth credentials (Anthropic Pro/Max, ChatGPT Plus/Pro).
    # Wrapped in rescue: until db:migrate has created oauth_credentials on this
    # environment AND active_record_encryption keys are set, the rest of
    # /integrations should still render — Composio toolkits don't depend on
    # any of this.
    ai_accounts_by_provider = begin
      if defined?(OauthCredential) && ActiveRecord::Base.connection.table_exists?("oauth_credentials")
        OauthCredential.where(organization_id: current_tenant.id, kind: "ai_provider")
                       .index_by(&:provider)
      else
        {}
      end
    rescue StandardError => e
      Rails.logger.warn("AI accounts lookup skipped: #{e.class}: #{e.message}")
      {}
    end

    # The page renders org-wide rows AND the current user's private rows.
    # Other users' personal integrations are intentionally hidden.
    visible_scope = current_tenant.integrations
      .where("scope = 'org' OR (scope = 'user' AND owner_user_id = ?)", current_user.id)
      .order(:service_name)

    # Per-user "Requested" state for catalog entries we don't yet have an
    # auth_config for. Used in the UI to show a "Requested" pill instead of
    # the "Request" button after the user clicks once.
    requested_slugs = begin
      if defined?(IntegrationRequest) && ActiveRecord::Base.connection.table_exists?("integration_requests")
        IntegrationRequest.open.where(user_id: current_user.id).pluck(:service_name)
      else
        []
      end
    rescue StandardError
      []
    end

    # Per-(org, provider) connect-mode policy + BYO-OAuth app creds. Keyed by
    # provider so the frontend can show the right default mode per app.
    org_configs = begin
      if defined?(OrgIntegrationConfig) && ActiveRecord::Base.connection.table_exists?("org_integration_configs")
        OrgIntegrationConfig.where(organization_id: current_tenant.id).map { |c|
          { provider: c.provider, mode: c.mode, client_id: c.client_id, has_secret: c.client_secret.present? }
        }
      else
        []
      end
    rescue StandardError
      []
    end

    render inertia: "integrations/index", props: {
      integrations: visible_scope.as_json(
        only: [ :id, :service_name, :status, :composio_connection_id, :created_at, :scope, :owner_user_id, :connect_mode, :provider_config_key ]
      ).map { |i|
        i.merge("is_mine" => i["scope"] == "user" && i["owner_user_id"] == current_user.id)
      },
      # NEW: static integration catalog (config/integrations.yml) — replaces the
      # live Composio toolkit list. Runs alongside supported_services during the
      # transition; the frontend prefers `catalog` when present.
      catalog: IntegrationCatalog.list(current_tenant.id),
      org_integration_configs: org_configs,
      nango_connect_base_url: ENV["NANGO_CONNECT_BASE_URL"],
      # Single source of truth — durable per-org cache populated by
      # RefreshComposioCacheJob (hourly + on-demand). Read straight from
      # Postgres on the hot path; no Composio HTTP call here.
      supported_services: ComposioSupported.list(current_tenant.id),
      requested_services: requested_slugs,
      ai_accounts: AI_PROVIDERS.map { |provider|
        cred = ai_accounts_by_provider[provider]
        {
          provider: provider,
          connected: cred.present?,
          account_email: cred&.account_email,
          expires_at: cred&.expires_at,
          last_refreshed_at: cred&.last_refreshed_at
        }
      },
      oauth_configured: {
        "anthropic" => ENV["WEBHOOK_BASE_URL"].present?,
        "openai"    => ENV["OPENAI_OAUTH_CLIENT_ID"].present?
      },
      # Direct OAuth-connected MCP servers (Meta Ads MCP, etc.) — connected
      # straight to the provider's MCP endpoint, no Composio broker.
      mcp_servers: begin
        if defined?(McpServer) && ActiveRecord::Base.connection.table_exists?("mcp_servers")
          McpServer.where(organization_id: current_tenant.id).order(:name).map do |s|
            { id: s.id, name: s.name, slug: s.slug, url: s.url, status: s.status, connected: s.connected? }
          end
        else
          []
        end
      rescue StandardError
        []
      end
    }
  end

  # POST /integrations/connect/:service_name
  # Redirects to Composio's hosted OAuth page for this org + app
  def connect
    service = params[:service_name]
    api_key = ENV["COMPOSIO_API_KEY"]

    unless api_key.present?
      respond_to do |format|
        format.json { render json: { error: "Composio API key is not configured on the server." }, status: :unprocessable_entity }
        format.html { redirect_to integrations_path, alert: "Composio API key not configured" }
      end
      return
    end

    begin
      # scope='org' → workspace bucket (everyone uses the same connection).
      # scope='user' → personal bucket (only this user's chats can use it).
      # Defaults to 'org' for back-compat with existing callers.
      scope = params[:scope].to_s == "user" ? "user" : "org"
      user_id = scope == "user" ? "user_#{current_user.id}" : "org_#{current_tenant.id}"
      callback_url = callback_integrations_url

      # Step 1: Find the auth config ID for this app
      auth_config_id = find_composio_auth_config(api_key, service)
      unless auth_config_id
        msg = "#{service.titleize} isn't set up in the Composio dashboard yet. Add it at composio.dev → Auth configs, then try Connect again."
        respond_to do |format|
          format.json { render json: { error: msg }, status: :unprocessable_entity }
          format.html { redirect_to integrations_path, alert: msg }
        end
        return
      end

      owner_user_id = scope == "user" ? current_user.id : nil
      locally_connected = current_tenant.integrations
        .where(service_name: service, scope: scope, owner_user_id: owner_user_id, status: "connected")
        .where.not(composio_connection_id: [ nil, "" ])
        .exists?

      unless locally_connected
        cleanup = disconnect_existing_composio_accounts(user_id, service)
        unless cleanup[:ok]
          msg = "Could not clear stale #{service.titleize} connection in Composio: #{cleanup[:message]}"
          respond_to do |format|
            format.json { render json: { error: msg }, status: :unprocessable_entity }
            format.html { redirect_to integrations_path, alert: msg }
          end
          return
        end
      end

      # Step 2: Create a connect link (initiates OAuth)
      response = composio_post("/api/v3/connected_accounts/link", api_key, {
        auth_config_id: auth_config_id,
        user_id: user_id,
        callback_url: callback_url
      })

      data = JSON.parse(response.body)
      Rails.logger.info "Composio connect link response (#{response.code}): #{data.to_json[0..500]}"

      url = data["redirect_url"] || data["redirectUrl"] || data["url"]
      connected_account_id = data["connected_account_id"]

      if url.present?
        # Don't create anything yet — wait for the callback to confirm
        # Store the pending info in the session so callback can use it
        session[:composio_pending] = {
          service: service,
          connected_account_id: connected_account_id,
          scope: scope
        }

        render json: { redirect_url: url }
      else
        error_msg = data["message"] || data["error"] || data.to_json[0..300]
        render json: { error: "Failed to connect #{service}: #{error_msg}" }, status: :unprocessable_entity
      end
    rescue Net::OpenTimeout, Net::ReadTimeout, Errno::ECONNREFUSED, SocketError => e
      Rails.logger.error "Composio connect network error: #{e.class}: #{e.message}"
      render json: { error: "Composio API unreachable — try again in a minute" }, status: :service_unavailable
    rescue => e
      Rails.logger.error "Composio connect error: #{e.class}: #{e.message}"
      render json: { error: "Connection failed: #{e.message}" }, status: :internal_server_error
    end
  end

  # GET /integrations/callback
  # Composio redirects here after OAuth. Runs inside the popup window.
  def callback
    pending = session.delete(:composio_pending)

    if pending
      service = pending["service"]
      connected_account_id = pending["connected_account_id"]
      scope = pending["scope"] == "user" ? "user" : "org"

      # Verify the connection is actually active on Composio
      api_key = ENV["COMPOSIO_API_KEY"]
      if api_key && connected_account_id
        res = composio_get("/api/v3/connected_accounts/#{connected_account_id}", api_key)
        data = JSON.parse(res.body) rescue {}
        status = data["status"]

        if %w[ACTIVE INITIATED INITIALIZING].include?(status)
          owner_user_id = scope == "user" ? current_user.id : nil
          # Lookup must include scope/owner so org + user connections to the
          # same service don't collide on the unique index.
          row = current_tenant.integrations
            .where(service_name: service, scope: scope, owner_user_id: owner_user_id)
            .first_or_initialize
          row.composio_connection_id = connected_account_id
          row.status = "connected"
          row.save!

          # Auto-install any SkillDefinition whose requires_connections
          # includes this service. Example: connect Apollo → every
          # integrations-enabled agent gets apollo-prospecting installed
          # (giving the agent the rich SKILL.md with real Composio tool
          # names + anti-patterns), instead of every agent having to
          # discover Apollo's gotchas at runtime.
          begin
            result = IntegrationSkillAutoInstaller.new(row).call
            if result.installed.positive?
              Rails.logger.info "IntegrationSkillAutoInstaller: #{service} → installed #{result.skills_matched.join(', ')} on #{result.installed} agent-skill rows (#{result.skipped} already present)"
            end
          rescue => e
            Rails.logger.warn "IntegrationSkillAutoInstaller failed for #{service}: #{e.class}: #{e.message}"
          end

          # Wake every engine in the org so each agent's
          # getActiveToolkits cache (60s TTL) flushes immediately.
          # Without this, an agent the user pings right after
          # connecting Apollo still sees "Apollo not connected" for
          # up to a minute. The sync handler (engine main.ts line 107)
          # already invalidates the toolkit cache on receipt.
          # NOTE: the auto-installer above already fired EngineSync
          # per agent it touched; this fan-out covers agents that
          # didn't need a skill install but still need the toolkit
          # cache flush.
          sync_agents_after_integration_change(row)
        end
      end
    end

    # Close the popup and refresh the parent page
    render html: <<~HTML.html_safe
      <html><body>
        <p>Connected! This window will close...</p>
        <script>
          if (window.opener) { window.opener.location.reload(); }
          window.close();
        </script>
      </body></html>
    HTML
  end

  # POST /integrations/:service_name/request — record demand for a Composio
  # catalog entry we don't yet have an auth_config for. Idempotent per (user,
  # service_name); subsequent clicks no-op so users can hit "Request" twice
  # without us double-counting.
  def request_integration
    slug = params[:service_name].to_s.downcase
    if slug.blank?
      redirect_to integrations_path, alert: "Missing service name"
      return
    end
    note = params[:note].to_s.presence

    rec = IntegrationRequest.find_or_initialize_by(
      organization_id: current_tenant.id,
      user_id: current_user.id,
      service_name: slug,
    )
    rec.note = note if note.present?
    rec.status ||= "pending"
    rec.save!

    Rails.logger.info "IntegrationRequest: org=#{current_tenant.id} user=#{current_user.id} service=#{slug} status=#{rec.status}"

    respond_to do |format|
      format.json { render json: { ok: true, status: rec.status } }
      format.html { redirect_to integrations_path, notice: "Requested #{slug.titleize} — we'll wire it up." }
    end
  end

  # POST /integrations/refresh — full bypass of the 5-min debounce + the
  # auth_configs Rails cache. Use when an admin just configured a new
  # auth_config in Composio and wants the integrations page to reflect it
  # without waiting for the next cron tick.
  def refresh
    Rails.cache.delete("composio:refresh_enq:org_#{current_tenant.id}")
    Rails.cache.delete("composio:auth_configs")
    Rails.cache.delete("composio:toolkits")
    RefreshComposioCacheJob.new.perform(current_tenant.id)
    redirect_to integrations_path, notice: "Integration catalog refreshed."
  rescue => e
    Rails.logger.warn "Integrations#refresh failed: #{e.class}: #{e.message}"
    redirect_to integrations_path, alert: "Refresh failed: #{e.message.truncate(120)}"
  end

  def destroy
    integration = current_tenant.integrations.find(params[:id])
    name = integration.service_name

    # Authz: a user can only delete org-scoped integrations OR their own
    # personal ones. Don't let user A nuke user B's Gmail.
    if integration.scope == "user" && integration.owner_user_id != current_user.id
      redirect_to integrations_path, alert: "Not your integration to disconnect."
      return
    end

    # Nango-backed (managed/byo_oauth): revoke the Nango connection.
    if integration.nango_connection_id.present? && integration.provider_config_key.present?
      begin
        Nango::Client.delete_connection(integration.nango_connection_id, integration.provider_config_key)
      rescue => e
        Rails.logger.warn "Nango disconnect failed for #{name}: #{e.class}: #{e.message}"
      end
    # byo_token: drop the pasted Credential.
    elsif integration.byo_token?
      current_tenant.credentials.where(provider: name, kind: "generic", agent_id: nil).destroy_all
    # Legacy Composio rows.
    elsif ENV["COMPOSIO_API_KEY"].present? && integration.composio_connection_id.present?
      result = disconnect_composio_integration(integration)
      unless result[:ok]
        redirect_to integrations_path, alert: "Could not disconnect #{name.titleize} from Composio: #{result[:message]}"
        return
      end
    end

    integration.destroy
    clear_composio_sync_cache
    sync_agents_after_integration_change(integration)
    redirect_to integrations_path, notice: "#{name.titleize} disconnected"
  end

  # ── Nango-backed connect flow ─────────────────────────────────────────────

  # POST /integrations/:service_name/nango_session
  # Managed / BYO-OAuth: mint a Nango Connect session token for the browser SDK.
  def nango_session
    entry = catalog_entry!(params[:service_name]) or return
    provider_config_key = entry[:provider_config_key]
    unless provider_config_key.present?
      return render json: { error: "#{entry[:label]} can't be connected with OAuth — paste a token instead." }, status: :unprocessable_entity
    end
    unless Nango::Client.configured?
      return render json: { error: "Nango is not configured on the server yet." }, status: :unprocessable_entity
    end

    # BYO-OAuth: run the OAuth dance on the org's own app credentials.
    cfg = OrgIntegrationConfig.find_by(organization_id: current_tenant.id, provider: entry[:slug])
    byo = cfg&.oauth_overrides

    session_res = Nango::Client.create_connect_session(
      organization: current_tenant, user: current_user,
      provider_config_key: provider_config_key, byo_overrides: byo
    )
    render json: {
      session_token: session_res["token"] || session_res.dig("data", "token"),
      connect_base_url: ENV["NANGO_CONNECT_BASE_URL"],
      provider_config_key: provider_config_key,
    }
  rescue Nango::Client::Error => e
    # Managed/BYO-OAuth needs the provider's OAuth app registered in Nango first.
    # Until an admin configures it, steer the user to paste-token instead of
    # surfacing a raw gateway error.
    if e.message.include?("Integration does not exist")
      render json: {
        error: "One-click connect for #{entry[:label]} isn't set up yet — paste a token instead, or have an admin add the #{entry[:label]} OAuth app in Nango.",
        needs_provider_config: true,
      }, status: :unprocessable_entity
    else
      render json: { error: "Could not start connection: #{e.message}" }, status: :bad_gateway
    end
  end

  # POST /integrations/:service_name/nango_finalize { connection_id, scope }
  # Called by the browser after the Connect UI succeeds. Upserts the Integration
  # row, auto-installs skills, and wakes the engines.
  def nango_finalize
    entry = catalog_entry!(params[:service_name]) or return
    connection_id = params[:connection_id].to_s
    return render(json: { error: "missing connection_id" }, status: :unprocessable_entity) if connection_id.blank?

    scope = params[:scope].to_s == "user" ? "user" : "org"
    mode  = OrgIntegrationConfig.mode_for(current_tenant.id, entry[:slug]) == "byo_oauth" ? "byo_oauth" : "managed"
    row = upsert_integration(entry[:slug], scope: scope, connect_mode: mode,
                             nango_connection_id: connection_id, provider_config_key: entry[:provider_config_key])
    after_connect(row)
    render json: { ok: true, id: row.id }
  end

  # POST /integrations/:service_name/paste_token { token, scope }
  # BYO-token: store the pasted key as a Credential and connect the app.
  def paste_token
    entry = catalog_entry!(params[:service_name]) or return
    token = params[:token].to_s.strip
    return render(json: { error: "missing token" }, status: :unprocessable_entity) if token.blank?
    scope = params[:scope].to_s == "user" ? "user" : "org"

    cred = current_tenant.credentials.find_or_initialize_by(provider: entry[:slug], kind: "generic", agent_id: nil)
    cred.name ||= "#{entry[:slug]}-token"
    cred.fields = { "value" => token }
    cred.save!

    row = upsert_integration(entry[:slug], scope: scope, connect_mode: "byo_token",
                             nango_connection_id: nil, provider_config_key: nil)
    after_connect(row)
    render json: { ok: true, id: row.id }
  end

  # POST /integrations/:service_name/org_config { mode, client_id, client_secret }
  # Org admin sets the default connect mode for an app + (byo_oauth) app creds.
  def org_config
    entry = catalog_entry!(params[:service_name]) or return
    cfg = OrgIntegrationConfig.find_or_initialize_by(organization_id: current_tenant.id, provider: entry[:slug])
    cfg.mode = params[:mode].to_s.presence || "managed"
    cfg.client_id = params[:client_id] if params.key?(:client_id)
    cfg.client_secret = params[:client_secret] if params[:client_secret].present?
    if cfg.save
      render json: { ok: true, mode: cfg.mode }
    else
      render json: { error: cfg.errors.full_messages.join(", ") }, status: :unprocessable_entity
    end
  end

  private

  # Look up a catalog entry or render a 404 JSON error (returns nil so callers
  # can `entry = catalog_entry!(...) or return`).
  def catalog_entry!(slug)
    entry = IntegrationCatalog.find(slug.to_s)
    render(json: { error: "Unknown integration #{slug}" }, status: :not_found) unless entry
    entry
  end

  # Create/update the Integration row for a (service, scope) — shared by every
  # Nango connect mode. Honors the org/user scope unique key.
  def upsert_integration(service, scope:, connect_mode:, nango_connection_id:, provider_config_key:)
    owner_user_id = scope == "user" ? current_user.id : nil
    row = current_tenant.integrations
      .where(service_name: service, scope: scope, owner_user_id: owner_user_id)
      .first_or_initialize
    row.assign_attributes(
      status: "connected", connect_mode: connect_mode,
      nango_connection_id: nango_connection_id, provider_config_key: provider_config_key,
    )
    row.save!
    row
  end

  # Post-connect side effects shared by every mode: auto-install matching
  # skills + wake every engine in the org. Mirrors the Composio callback.
  def after_connect(row)
    begin
      result = IntegrationSkillAutoInstaller.new(row).call
      if result.installed.positive?
        Rails.logger.info "IntegrationSkillAutoInstaller: #{row.service_name} → installed on #{result.installed} agent-skill rows"
      end
    rescue => e
      Rails.logger.warn "IntegrationSkillAutoInstaller failed for #{row.service_name}: #{e.class}: #{e.message}"
    end
    sync_agents_after_integration_change(row)
  end

  def find_composio_auth_config(api_key, app_name)
    response = composio_get("/api/v3/auth_configs", api_key)
    data = JSON.parse(response.body)
    items = data["items"] || data

    # Match by toolkit.slug (the actual app identifier)
    config = Array(items).find { |c|
      slug = c.dig("toolkit", "slug") || c["name"] || ""
      slug.downcase.gsub(/[-_]/, "").include?(app_name.downcase.gsub(/[-_]/, ""))
    }

    id = config&.dig("id")
    Rails.logger.info "Composio: auth_config for #{app_name} = #{id || 'NOT FOUND'} (toolkit: #{config&.dig("toolkit", "slug")})"
    unless id
      available = Array(items).map { |c| c.dig("toolkit", "slug") }.compact
      Rails.logger.info "Composio: available = #{available.join(", ")}"
    end
    id
  end

  def composio_get(path, api_key)
    uri = URI("https://backend.composio.dev#{path}")
    req = Net::HTTP::Get.new(uri)
    req["x-api-key"] = api_key
    req["Content-Type"] = "application/json"
    # Tight timeouts — when Composio is degraded we'd rather render the page
    # with stale data than block for 30+ seconds.
    Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, open_timeout: 3, read_timeout: 5) { |http| http.request(req) }
  end

  def composio_delete(path, api_key)
    uri = URI("https://backend.composio.dev#{path}")
    req = Net::HTTP::Delete.new(uri)
    req["x-api-key"] = api_key
    req["Content-Type"] = "application/json"
    Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, open_timeout: 3, read_timeout: 8) { |http| http.request(req) }
  end

  def disconnect_composio_integration(integration)
    service = integration.service_name.to_s.downcase
    user_id = integration.composio_user_id
    ids = []

    ids << integration.composio_connection_id if integration.composio_connection_id.present?
    ids.concat(composio_connection_ids_for(user_id, service))
    disconnect_composio_accounts(user_id, service, ids)
  rescue => e
    Rails.logger.warn "Composio disconnect error: #{e.class}: #{e.message}"
    { ok: false, message: e.message }
  end

  def disconnect_existing_composio_accounts(user_id, service)
    disconnect_composio_accounts(user_id, service, composio_connection_ids_for(user_id, service))
  rescue => e
    Rails.logger.warn "Composio stale connection cleanup failed: #{e.class}: #{e.message}"
    { ok: false, message: e.message }
  end

  def disconnect_composio_accounts(user_id, service, ids)
    api_key = ENV["COMPOSIO_API_KEY"]
    ids = ids.compact.map(&:to_s).reject(&:blank?).uniq

    if ids.empty?
      Rails.logger.info "Composio disconnect #{service}: no remote connected account found for #{user_id}; removing local row"
      return { ok: true, message: "already disconnected" }
    end

    failures = []
    ids.each do |id|
      res = composio_delete("/api/v3/connected_accounts/#{id}", api_key)
      Rails.logger.info "Composio disconnect #{service} (#{id}, bucket=#{user_id}): #{res.code} #{res.body.to_s[0..200]}"
      next if res.is_a?(Net::HTTPSuccess) || res.code == "404"

      failures << "#{id} HTTP #{res.code}: #{res.body.to_s[0..200]}"
    end

    if failures.any?
      { ok: false, message: failures.join("; ") }
    else
      { ok: true, message: "disconnected #{ids.length} remote account(s)" }
    end
  end

  def composio_connection_ids_for(user_id, service)
    ids = []
    cursor = nil

    loop do
      params = { user_ids: [ user_id ], toolkit_slugs: [ service ], limit: 100 }
      params[:cursor] = cursor if cursor.present?
      query = composio_query(params)
      res = composio_get("/api/v3/connected_accounts?#{query}", ENV["COMPOSIO_API_KEY"])
      unless res.is_a?(Net::HTTPSuccess)
        raise "connected_accounts list HTTP #{res.code}: #{res.body.to_s[0..200]}"
      end

      data = JSON.parse(res.body) rescue {}
      Array(data["items"]).each do |account|
        slug = account.dig("toolkit", "slug") || account["appName"] || account["app_name"]
        next unless same_composio_toolkit?(slug, service)

        ids << account["id"]
      end

      cursor = data["next_cursor"] || data["nextCursor"]
      break if cursor.blank?
    end

    ids.compact.map(&:to_s).reject(&:blank?).uniq
  end

  def same_composio_toolkit?(left, right)
    left.to_s.downcase.gsub(/[-_]/, "") == right.to_s.downcase.gsub(/[-_]/, "")
  end

  def composio_query(params)
    # Comma-joined scalars — Composio's v3 API rejects JSON-array values
    # (user_ids=["org_1"] → HTTP 400 validation error).
    encoded = params.transform_values { |value| value.is_a?(Array) ? value.join(",") : value }
    URI.encode_www_form(encoded)
  end

  def clear_composio_sync_cache
    Rails.cache.delete("composio:sync:org_#{current_tenant.id}:user_#{current_user.id}")
    Rails.cache.delete("composio:refresh_enq:org_#{current_tenant.id}")
    Rails.cache.delete("composio:auth_configs")
    Rails.cache.delete("composio:toolkits")
  end

  def sync_agents_after_integration_change(integration)
    Agent.where(organization_id: integration.organization_id).find_each do |agent|
      EngineSync.trigger(agent) rescue nil
    end
  end

  # Fetch active Composio connections and sync to our DB. Pulls both the
  # workspace bucket (org_<id>) AND the current user's bucket (user_<id>).
  # Creates rows tagged with the right scope; marks stale rows disconnected.
  # Extracted to a service so the bundle-deploy wizard can run the same
  # sync (failure-safe: a failed Composio fetch skips stale-marking
  # instead of mass-flipping rows to disconnected).
  def sync_composio_connections
    ComposioConnectionSync.call(organization: current_tenant, user: current_user)
  end

  def composio_post(path, api_key, body)
    uri = URI("https://backend.composio.dev#{path}")
    req = Net::HTTP::Post.new(uri)
    req["x-api-key"] = api_key
    req["Content-Type"] = "application/json"
    req.body = body.to_json
    Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, open_timeout: 5, read_timeout: 10) { |http| http.request(req) }
  end
end
