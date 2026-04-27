class IntegrationsController < ApplicationController
  before_action :authenticate_user!

  def index
    # Sync connection state from Composio on every page load
    sync_composio_connections if ENV["COMPOSIO_API_KEY"].present?

    # Subscription OAuth credentials (Anthropic Pro/Max, ChatGPT Plus/Pro).
    # Separate from tool integrations — these never get loaded as MCP servers.
    ai_accounts = OauthCredential.where(organization_id: current_tenant.id, kind: "ai_provider")
                                  .index_by(&:provider)

    render inertia: "integrations/index", props: {
      integrations: current_tenant.integrations.order(:service_name).as_json(
        only: [:id, :service_name, :status, :composio_connection_id, :created_at]
      ),
      ai_accounts: OauthCredential::PROVIDERS.map { |provider|
        cred = ai_accounts[provider]
        {
          provider: provider,
          connected: cred.present?,
          account_email: cred&.account_email,
          expires_at: cred&.expires_at,
          last_refreshed_at: cred&.last_refreshed_at,
        }
      },
      # Self-identifying client model — we host our own metadata at
      # /oauth/:provider/client-metadata. Always "configured" as long as the
      # app has a base URL set (which it does, since email + invitations
      # already need it).
      oauth_configured: {
        "anthropic" => ENV["WEBHOOK_BASE_URL"].present?,
        "openai"    => ENV["WEBHOOK_BASE_URL"].present?,
      },
    }
  end

  # POST /integrations/connect/:service_name
  # Redirects to Composio's hosted OAuth page for this org + app
  def connect
    service = params[:service_name]
    api_key = ENV["COMPOSIO_API_KEY"]

    unless api_key.present?
      redirect_to integrations_path, alert: "Composio API key not configured"
      return
    end

    begin
      user_id = "org_#{current_tenant.id}"
      callback_url = callback_integrations_url

      # Step 1: Find the auth config ID for this app
      auth_config_id = find_composio_auth_config(api_key, service)
      unless auth_config_id
        redirect_to integrations_path, alert: "No auth config found for #{service}. Set it up in the Composio dashboard first."
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

      # Verify the connection is actually active on Composio
      api_key = ENV["COMPOSIO_API_KEY"]
      if api_key && connected_account_id
        res = composio_get("/api/v3/connected_accounts/#{connected_account_id}", api_key)
        data = JSON.parse(res.body) rescue {}
        status = data["status"]

        if status == "ACTIVE" || status == "INITIATED"
          current_tenant.integrations.find_or_create_by!(service_name: service) do |i|
            i.composio_connection_id = connected_account_id
            i.status = "connected"
          end
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

    # Delete ALL Composio connections for this service (active + expired)
    if ENV["COMPOSIO_API_KEY"].present?
      begin
        user_id = "org_#{current_tenant.id}"
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
    Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, open_timeout: 5, read_timeout: 10) { |http| http.request(req) }
  end

  # Fetch active connections from Composio and sync to our DB.
  # Creates missing records, removes stale ones.
  def sync_composio_connections
    api_key = ENV["COMPOSIO_API_KEY"]
    user_id = "org_#{current_tenant.id}"

    res = composio_get("/api/v3/connected_accounts?user_ids=#{user_id}&statuses=ACTIVE", api_key)
    data = JSON.parse(res.body) rescue {}
    items = data["items"] || []

    # Build a map of active Composio connections: toolkit_slug → connection_id
    active = {}
    items.each do |c|
      slug = c.dig("toolkit", "slug") || c.dig("appName") || next
      active[slug] = c["id"]
    end

    # Create/update local records for active connections
    active.each do |slug, conn_id|
      integration = current_tenant.integrations.find_or_initialize_by(service_name: slug)
      integration.assign_attributes(composio_connection_id: conn_id, status: "connected")
      integration.save! if integration.changed?
    end

    # Mark local records as disconnected if not in Composio anymore
    current_tenant.integrations.where(status: "connected").each do |i|
      unless active.key?(i.service_name)
        i.update!(status: "disconnected")
      end
    end
  rescue => e
    Rails.logger.warn "Composio sync error: #{e.message}"
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
