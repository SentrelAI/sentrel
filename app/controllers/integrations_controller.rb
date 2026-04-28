class IntegrationsController < ApplicationController
  before_action :authenticate_user!

  # Locally enumerated so the controller can render even if the OauthCredential
  # constant fails to autoload (encryption-keys not configured yet, etc.).
  AI_PROVIDERS = %w[anthropic openai].freeze

  def index
    # Sync connection state from Composio — but rate-limit to once every 60s
    # per user so a slow Composio API doesn't block every page render. The
    # local integrations table is fine to render in the gap.
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

    render inertia: "integrations/index", props: {
      integrations: visible_scope.as_json(
        only: [:id, :service_name, :status, :composio_connection_id, :created_at, :scope, :owner_user_id]
      ).map { |i|
        i.merge("is_mine" => i["scope"] == "user" && i["owner_user_id"] == current_user.id)
      },
      # Single source of truth — fetched from Composio + curated catalog.
      # Each row: { slug, label, category, description, available, logo }.
      supported_services: ComposioSupported.list,
      ai_accounts: AI_PROVIDERS.map { |provider|
        cred = ai_accounts_by_provider[provider]
        {
          provider: provider,
          connected: cred.present?,
          account_email: cred&.account_email,
          expires_at: cred&.expires_at,
          last_refreshed_at: cred&.last_refreshed_at,
        }
      },
      oauth_configured: {
        "anthropic" => ENV["WEBHOOK_BASE_URL"].present?,
        "openai"    => ENV["OPENAI_OAUTH_CLIENT_ID"].present?,
      },
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

      # Step 2: Create a connect link (initiates OAuth)
      response = composio_post("/api/v3/connected_accounts/link", api_key, {
        auth_config_id: auth_config_id,
        user_id: user_id,
        callback_url: callback_url,
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
          scope: scope,
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

        if status == "ACTIVE" || status == "INITIATED"
          owner_user_id = scope == "user" ? current_user.id : nil
          # Lookup must include scope/owner so org + user connections to the
          # same service don't collide on the unique index.
          row = current_tenant.integrations
            .where(service_name: service, scope: scope, owner_user_id: owner_user_id)
            .first_or_initialize
          row.composio_connection_id = connected_account_id
          row.status = "connected"
          row.save!
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

  def destroy
    integration = current_tenant.integrations.find(params[:id])
    name = integration.service_name

    # Authz: a user can only delete org-scoped integrations OR their own
    # personal ones. Don't let user A nuke user B's Gmail.
    if integration.scope == "user" && integration.owner_user_id != current_user.id
      redirect_to integrations_path, alert: "Not your integration to disconnect."
      return
    end

    # Delete only the matching Composio bucket (org_<id> vs user_<id>) so
    # we don't accidentally yank the org's connection when removing a
    # personal one or vice versa.
    if ENV["COMPOSIO_API_KEY"].present?
      begin
        user_id = integration.composio_user_id
        res = composio_get("/api/v3/connected_accounts?user_ids=#{user_id}", ENV["COMPOSIO_API_KEY"])
        items = (JSON.parse(res.body)["items"] rescue []) || []
        items.each do |c|
          next unless (c.dig("toolkit", "slug") || "").downcase == name.downcase
          uri = URI("https://backend.composio.dev/api/v3/connected_accounts/#{c["id"]}")
          req = Net::HTTP::Delete.new(uri)
          req["x-api-key"] = ENV["COMPOSIO_API_KEY"]
          dres = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true) { |http| http.request(req) }
          Rails.logger.info "Composio disconnect #{name} (#{c["id"]}): #{dres.code}"
        end
      rescue => e
        Rails.logger.warn "Composio disconnect error: #{e.message}"
      end
    end

    integration.destroy
    redirect_to integrations_path, notice: "#{name.titleize} disconnected"
  end

  private

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

  # Fetch active Composio connections and sync to our DB. Pulls both the
  # workspace bucket (org_<id>) AND the current user's bucket (user_<id>).
  # Creates rows tagged with the right scope; marks stale rows disconnected.
  def sync_composio_connections
    api_key = ENV["COMPOSIO_API_KEY"]
    org_user_id  = "org_#{current_tenant.id}"
    self_user_id = "user_#{current_user.id}"

    org_active  = composio_active_for(api_key, org_user_id)
    self_active = composio_active_for(api_key, self_user_id)

    # Org bucket → scope='org', no owner.
    org_active.each do |slug, conn_id|
      row = current_tenant.integrations
        .where(service_name: slug, scope: "org", owner_user_id: nil)
        .first_or_initialize
      row.assign_attributes(composio_connection_id: conn_id, status: "connected")
      row.save! if row.changed?
    end
    # Personal bucket → scope='user', owner = current_user.
    self_active.each do |slug, conn_id|
      row = current_tenant.integrations
        .where(service_name: slug, scope: "user", owner_user_id: current_user.id)
        .first_or_initialize
      row.assign_attributes(composio_connection_id: conn_id, status: "connected")
      row.save! if row.changed?
    end

    # Mark stale rows disconnected — only consider what's visible to this user.
    visible = current_tenant.integrations
      .where(status: "connected")
      .where("scope = 'org' OR (scope = 'user' AND owner_user_id = ?)", current_user.id)
    visible.find_each do |i|
      bucket = i.scope == "user" ? self_active : org_active
      i.update!(status: "disconnected") unless bucket.key?(i.service_name)
    end
  rescue => e
    Rails.logger.warn "Composio sync error: #{e.message}"
  end

  def composio_active_for(api_key, composio_user_id)
    res = composio_get("/api/v3/connected_accounts?user_ids=#{composio_user_id}&statuses=ACTIVE", api_key)
    data = JSON.parse(res.body) rescue {}
    items = data["items"] || []
    items.each_with_object({}) do |c, acc|
      slug = c.dig("toolkit", "slug") || c.dig("appName") || next
      acc[slug] = c["id"]
    end
  rescue => e
    Rails.logger.warn "Composio active sync (#{composio_user_id}) failed: #{e.message}"
    {}
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
