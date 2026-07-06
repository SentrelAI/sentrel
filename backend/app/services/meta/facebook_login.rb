require "net/http"
require "json"

module Meta
  # Facebook Login for Business (FLB) — multi-tenant Meta auth.
  #
  # SCAFFOLD, GATED BEHIND A FLAG. This is the scalable path for connecting
  # EXTERNAL customers' own Meta ad accounts/Pages: each customer OAuths through
  # FLB and we mint a Business Integration **System User access token** scoped to
  # the assets + permissions in a saved FLB "configuration". System User tokens
  # are server-to-server, need no re-auth, and (per Meta's current guidance) use
  # the 60-day-expiring variant refreshed unattended within the window.
  #
  # WHY IT'S BEHIND A FLAG: the FLB OAuth scopes (ads_management,
  # business_management, pages_manage_posts, instagram_content_publish, …) only
  # function for accounts you don't own AFTER the app has **Advanced Access via
  # Meta App Review + Business Verification**. Until then this stays inert and
  # the design-partner bridge (a System User added to the client's Business
  # Manager) is used instead. See docs + the deep-research report.
  #
  # TO ACTIVATE post-approval, set:
  #   META_FBL_ENABLED=true
  #   META_APP_ID, META_APP_SECRET            (the reviewed Meta app)
  #   META_FBL_CONFIG_ID                       (FLB configuration: token type =
  #                                             System User, assets + scopes)
  #   META_GRAPH_VERSION                        (e.g. v21.0)
  # …then wire #authorize_url into the Meta connect button (tool: mcp path) and
  # persist the returned token per-org (reuse McpServer or a MetaConnection row).
  module FacebookLogin
    module_function

    class Error < StandardError; end

    def enabled?
      ActiveModel::Type::Boolean.new.cast(ENV["META_FBL_ENABLED"])
    end

    def graph_version
      ENV.fetch("META_GRAPH_VERSION", "v21.0")
    end

    # Step 1 — send the customer to Meta's consent screen for our FLB config.
    # The config_id selects the saved configuration (System User token type +
    # the asset/permission set), so we don't pass a scope list here.
    def authorize_url(redirect_uri:, state:)
      raise Error, "FLB not enabled" unless enabled?
      params = {
        client_id: ENV.fetch("META_APP_ID"),
        config_id: ENV.fetch("META_FBL_CONFIG_ID"),
        redirect_uri: redirect_uri,
        state: state,
        response_type: "code",
        override_default_response_type: true
      }
      "https://www.facebook.com/#{graph_version}/dialog/oauth?#{URI.encode_www_form(params)}"
    end

    # Step 2 — exchange the callback `code` for the access token. With a System
    # User FLB configuration, the returned token IS a System User token scoped to
    # the granted assets. Done server-side (app secret never leaves Rails).
    def exchange_code(code:, redirect_uri:)
      raise Error, "FLB not enabled" unless enabled?
      res = get_json("/#{graph_version}/oauth/access_token",
        client_id: ENV.fetch("META_APP_ID"),
        client_secret: ENV.fetch("META_APP_SECRET"),
        redirect_uri: redirect_uri,
        code: code)
      { access_token: res["access_token"], token_type: res["token_type"], expires_in: res["expires_in"] }
    end

    # Step 3 — refresh a 60-day expiring System User token within its window
    # (unattended; failing to refresh in 60 days forfeits it and the customer
    # must re-consent). FLB business-integration tokens refresh via the
    # fb_exchange_token grant: trade the current (still-valid) token for a
    # fresh 60-day one. MetaFblRefreshJob calls this daily for tokens nearing
    # expiry. Returns { access_token:, expires_in: }.
    def refresh(current_token)
      raise Error, "FLB not enabled" unless enabled?
      res = get_json("/#{graph_version}/oauth/access_token",
        grant_type: "fb_exchange_token",
        client_id: ENV.fetch("META_APP_ID"),
        client_secret: ENV.fetch("META_APP_SECRET"),
        fb_exchange_token: current_token)
      { access_token: res["access_token"], expires_in: res["expires_in"] }
    end

    # The self-hosted Meta Ads MCP the token is used against (the engine sends
    # it as the Bearer for mcp__meta_ads__* tools). Kept here so the FLB
    # callback can create the org's McpServer row without hardcoding the URL
    # in a controller.
    def default_mcp_url
      ENV.fetch("META_MCP_URL", "https://sentrel-meta-mcp.fly.dev/mcp")
    end

    # Optional — debug a token (validity, scopes, expiry) via the debug endpoint.
    def debug_token(token)
      get_json("/#{graph_version}/debug_token",
        input_token: token,
        access_token: "#{ENV.fetch('META_APP_ID')}|#{ENV.fetch('META_APP_SECRET')}")
    end

    # ── internals ───────────────────────────────────────────────────────────

    def get_json(path, **query)
      uri = URI("https://graph.facebook.com#{path}")
      uri.query = URI.encode_www_form(query)
      res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, open_timeout: 5, read_timeout: 15) do |http|
        http.get(uri.request_uri)
      end
      body = JSON.parse(res.body) rescue {}
      raise Error, "meta #{res.code}: #{(body.dig('error', 'message') || res.body).to_s[0, 300]}" unless res.is_a?(Net::HTTPSuccess)
      body
    end
  end
end
