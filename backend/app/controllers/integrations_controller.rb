class IntegrationsController < ApplicationController
  before_action :authenticate_user!

  # Locally enumerated so the controller can render even if the OauthCredential
  # constant fails to autoload (encryption-keys not configured yet, etc.).
  AI_PROVIDERS = %w[anthropic openai].freeze

  def index
    # Backfill the app directory (catalog_apps) from Nango /providers on first
    # load if it's empty — so the rich directory populates without a manual
    # command. Debounced; the daily CatalogSyncJob cron keeps it fresh after.
    # Until it's populated, IntegrationCatalog falls back to the static YAML.
    begin
      if defined?(CatalogApp) && ActiveRecord::Base.connection.table_exists?("catalog_apps") &&
         !CatalogApp.where(published: true).exists? && Rails.cache.read("catalog:backfill").blank?
        Rails.cache.write("catalog:backfill", Time.current, expires_in: 5.minutes)
        CatalogSyncJob.perform_later
      end
    rescue StandardError => e
      Rails.logger.warn "catalog backfill enqueue skipped: #{e.class}: #{e.message}"
    end

    # Subscription OAuth credentials (Anthropic Pro/Max, ChatGPT Plus/Pro).
    # Wrapped in rescue: until db:migrate has created oauth_credentials on this
    # environment AND active_record_encryption keys are set, the rest of
    # /integrations should still render — the integration catalog doesn't
    # depend on any of this.
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
        only: [ :id, :service_name, :status, :created_at, :scope, :owner_user_id, :connect_mode, :provider_config_key ]
      ).map { |i|
        i.merge("is_mine" => i["scope"] == "user" && i["owner_user_id"] == current_user.id)
      },
      # Static integration catalog (config/integrations.yml) — the connectable
      # app directory rendered by the frontend.
      catalog: IntegrationCatalog.list(current_tenant.id, configured_keys: Nango::Client.configured_provider_keys),
      # One-click Meta connect (Facebook Login for Business). When enabled, the
      # Meta Ads card routes to /meta/fbl/start instead of the token guide.
      meta_fbl_enabled: Meta::FacebookLogin.enabled?,
      org_integration_configs: org_configs,
      nango_connect_base_url: ENV["NANGO_CONNECT_BASE_URL"],
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
      # straight to the provider's MCP endpoint.
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

  # GET /integrations/activity
  # Observability: the org's recent connected-app API calls (from the audit
  # log the proxy writes), plus a per-provider summary with error rates.
  def activity
    logs = AuditLog.where(organization_id: current_tenant.id, action: "nango_proxy")
                   .includes(:agent).order(created_at: :desc).limit(200)
    calls = logs.map do |l|
      input = l.input || {}
      output = l.output || {}
      {
        id: l.id, at: l.created_at.iso8601, agent: l.agent&.name,
        provider: input["provider"], method: input["method"], path: input["path"],
        result: l.status, upstream: output["status"],
        error: output["error"], error_kind: output["error_kind"], latency_ms: output["latency_ms"]
      }
    end
    summary = calls.group_by { |c| c[:provider] }.map { |prov, cs|
      errors = cs.count { |c| c[:result] == "error" }
      { provider: prov, calls: cs.size, errors: errors,
        error_rate: cs.empty? ? 0 : (errors * 100.0 / cs.size).round,
        p50_ms: median(cs.filter_map { |c| c[:latency_ms] }) }
    }.sort_by { |s| -s[:calls] }
    render inertia: "integrations/activity", props: { calls: calls, summary: summary }
  end

  # POST /integrations/:service_name/request — record demand for a
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
    end

    integration.destroy
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
      provider_config_key: provider_config_key
    }
  rescue Nango::Client::Error => e
    # Managed/BYO-OAuth needs the provider's OAuth app registered in Nango first.
    # Until an admin configures it, steer the user to paste-token instead of
    # surfacing a raw gateway error.
    if e.message.include?("Integration does not exist")
      render json: {
        error: "One-click connect for #{entry[:label]} isn't set up yet — paste a token instead, or have an admin add the #{entry[:label]} OAuth app in Nango.",
        needs_provider_config: true
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

    # Capture the connection this row pointed at BEFORE we repoint it. The Connect
    # UI mints a fresh connection on every (re)connect, so without revoking the
    # old one we accumulate orphans in Nango and the row's pointer drifts. We
    # enforce a strict 1:1 map: one Integration row ↔ exactly one live Nango
    # connection. Revoke happens AFTER the new one is stored, so a failed reconnect
    # never leaves the row pointing at nothing.
    owner_user_id = scope == "user" ? current_user.id : nil
    prior_connection_id = current_tenant.integrations
      .where(service_name: entry[:slug], scope: scope, owner_user_id: owner_user_id)
      .pick(:nango_connection_id)

    row = upsert_integration(entry[:slug], scope: scope, connect_mode: mode,
                             nango_connection_id: connection_id, provider_config_key: entry[:provider_config_key])

    if prior_connection_id.present? && prior_connection_id != connection_id
      begin
        Nango::Client.delete_connection(prior_connection_id, entry[:provider_config_key])
        Rails.logger.info "nango_finalize: revoked superseded connection #{prior_connection_id} for #{entry[:slug]}"
      rescue Nango::Client::Error => e
        Rails.logger.warn "nango_finalize: couldn't revoke prior connection #{prior_connection_id}: #{e.message}"
      end
    end

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

  def median(arr)
    return nil if arr.empty?
    sorted = arr.map(&:to_i).sort
    mid = sorted.size / 2
    sorted.size.odd? ? sorted[mid] : ((sorted[mid - 1] + sorted[mid]) / 2.0).round
  end

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
  # skills + wake every engine in the org.
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

  def sync_agents_after_integration_change(integration)
    Agent.where(organization_id: integration.organization_id).find_each do |agent|
      EngineSync.trigger(agent) rescue nil
    end
  end
end
