require "ipaddr"
require "resolv"

# Connect/manage external MCP servers (Meta Ads MCP, Linear, Notion, …).
# Mirrors OauthController's PKCE pattern, but the endpoints are *discovered*
# from the MCP server rather than hardcoded — so any MCP works, not just Meta.
#
# Two entry points share this controller: the Integrations page, and the
# "Connect <name> MCP" card an agent posts in chat (propose_mcp_connection).
# The card passes the proposal's approval_token along; once the server is
# connected we resolve that proposal, which resumes the agent's work with the
# new tools loaded — the user never has to leave the chat or re-prompt.
class McpServersController < ApplicationController
  # The engine mounts external servers in the same namespace as its built-in
  # ones (mcp__<slug>__<tool>), so a server must never take one of these names.
  RESERVED_SLUGS = %w[apps approvals browser code connections doc files identity image integrations
                      knowledge recall scheduling search secrets skills tasks video].freeze

  # GET /mcp_servers
  def index
    servers = McpServer.where(organization_id: current_tenant.id).order(:name)
    render json: servers.map { |s| serialize(s) }
  end

  # POST /mcp_servers/probe { url }
  # → { auth: "none" | "oauth" | "token", host }
  # What connecting this URL will ask of the user, so the chat card can show
  # the right control (Connect / Sign in / token field) up front. Persists
  # nothing.
  def probe
    url = mcp_url(params[:url])
    return render json: { error: invalid_url_message }, status: :unprocessable_entity unless url

    render json: { auth: resolve_auth(url)[:mode], host: URI(url).host }
  rescue Mcp::Oauth::Unreachable => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  # POST /mcp_servers { name, slug, url, client_id?, access_token?, approval_token? }
  # Token given → store it and connect. Otherwise probe the server: a public
  # one connects on the spot; an OAuth one is set up for /connect; anything
  # else answers 422 with needs_token so the caller can ask for one.
  def create
    p = params.permit(:name, :slug, :url, :client_id, :access_token, :transport, :approval_token)
    url = mcp_url(p[:url])
    return render json: { error: invalid_url_message }, status: :unprocessable_entity unless url

    slug = mcp_slug(p[:slug].presence || p[:name].presence || URI(url).host)
    proposal = pending_proposal(p[:approval_token])

    # Token-auth MCP servers (e.g. the Pipeboard-based Meta Ads MCP) don't speak
    # the MCP OAuth spec — they authenticate with a static Bearer token and 401
    # the .well-known discovery endpoints, so `Mcp::Oauth.discover` can't run.
    # If the caller supplies a token, skip discovery and connect directly (the
    # engine sends it as `Authorization: Bearer <token>`, see external-mcp.ts).
    if p[:access_token].present?
      # Meta tokens get validated against the Graph API before we accept them —
      # instant "invalid token" feedback beats a cryptic tool failure later.
      if slug == "meta_ads" && (err = meta_token_error(p[:access_token]))
        return render json: { error: err }, status: :unprocessable_entity
      end
      # Any other server: one authenticated handshake shows whether it takes the token.
      if slug != "meta_ads" && Mcp::Oauth.probe(url, transport: p[:transport].presence || transport_for(url), token: p[:access_token])[:auth] == :required
        return render json: { error: "#{URI(url).host} rejected that token. Check it and try again.", needs_token: true },
                      status: :unprocessable_entity
      end

      # Upsert on (org, slug) so RE-connecting (pasting a fresh token) updates
      # the existing row instead of tripping the slug-uniqueness validation.
      server = upsert_server(slug, name: p[:name], url: url, proposal: proposal)
      server.assign_attributes(
        transport:    p[:transport].presence || server.transport.presence || "http",
        auth_mode:    "token",
        access_token: p[:access_token],
        expires_at:   nil, # static tokens: no known expiry — health checks catch death
        status:       "connected",
        last_error:   nil,
      )
      server.save!
      connected!(server, proposal)
      return render json: serialize(server), status: :created
    end

    transport = p[:transport].presence || transport_for(url)
    auth = resolve_auth(url, transport: transport, client_id: p[:client_id])
    case auth[:mode]
    when "none"
      server = upsert_server(slug, name: p[:name], url: url, proposal: proposal)
      server.update!(transport: transport, auth_mode: "none", access_token: nil, refresh_token: nil,
                     expires_at: nil, status: "connected", last_error: nil)
      connected!(server, proposal)
      render json: serialize(server), status: :created
    when "oauth"
      server = setup_oauth_server!(slug, name: p[:name], url: url, transport: transport,
                                   meta: auth[:meta], client_id: p[:client_id], proposal: proposal)
      render json: serialize(server).merge(connect_url: connect_mcp_server_path(server)), status: :created
    else
      render json: { error: "#{p[:name].presence || URI(url).host} needs an access token to connect.", needs_token: true },
             status: :unprocessable_entity
    end
  rescue Mcp::Oauth::Unreachable => e
    render json: { error: e.message }, status: :unprocessable_entity
  rescue => e
    render json: { error: "Couldn't set up MCP server: #{e.message}" }, status: :unprocessable_entity
  end

  # POST /mcp_servers/authorize (a form the chat card submits into a popup)
  # Set the server up (discovery + dynamic client registration) and send the
  # popup straight on to the provider's consent screen; the callback reports
  # back to the card and closes the popup. A form POST, not a link, so a
  # cross-site page can't plant a server in the org by sending a signed-in
  # user here.
  def authorize
    p = params.permit(:name, :url, :approval_token)
    token = p[:approval_token].presence
    url = mcp_url(p[:url])
    return render_popup_result(ok: false, error: invalid_url_message, approval_token: token) unless url

    transport = transport_for(url)
    auth = resolve_auth(url, transport: transport)
    unless auth[:mode] == "oauth"
      return render_popup_result(ok: false, error: "#{URI(url).host} doesn't offer sign-in — connect it with a token instead.",
                                 approval_token: token)
    end

    proposal = pending_proposal(p[:approval_token])
    server = setup_oauth_server!(mcp_slug(p[:name].presence || URI(url).host), name: p[:name], url: url,
                                 transport: transport, meta: auth[:meta], proposal: proposal)
    start_oauth(server, popup: true, approval_token: proposal&.approval_token)
  rescue => e
    Rails.logger.error("MCP authorize failed: #{e.class}: #{e.message}")
    render_popup_result(ok: false, error: e.message, approval_token: token)
  end

  # GET /mcp_servers/:id/connect → PKCE → redirect to the MCP's consent screen.
  def connect
    server = McpServer.find_by!(id: params[:id], organization_id: current_tenant.id)
    start_oauth(server, popup: params[:popup].present?)
  end

  # GET /mcp_servers/callback?code=&state= → exchange + persist + sync agents.
  def callback
    pk = session.delete(:mcp_oauth) || {}
    popup = pk["popup"] == true
    approval_token = pk["approval_token"]
    fail_with = ->(message) {
      if popup
        render_popup_result(ok: false, error: message, approval_token: approval_token)
      else
        redirect_to(integrations_path, alert: message)
      end
    }
    return fail_with.("MCP OAuth state mismatch — reconnect.") if pk["state"].blank? || pk["state"] != params[:state]
    return fail_with.(params[:error_description].presence || "MCP OAuth missing code.") if params[:code].blank?
    return fail_with.("MCP OAuth session mismatch.") if pk["org_id"].to_i != current_tenant.id

    server = McpServer.find_by!(id: pk["server_id"], organization_id: current_tenant.id)
    tokens = Mcp::Oauth.exchange_code(server, code: params[:code], code_verifier: pk["code_verifier"], redirect_uri: callback_mcp_servers_url)
    Mcp::Oauth.apply_tokens!(server, tokens)
    connected!(server, pending_proposal(approval_token))
    return render_popup_result(ok: true, server: server, approval_token: approval_token) if popup
    redirect_to integrations_path, notice: "Connected #{server.name}"
  rescue => e
    Rails.logger.error("MCP OAuth callback failed: #{e.class}: #{e.message}")
    server&.update(status: "error", last_error: e.message.to_s[0, 500])
    fail_with ? fail_with.("MCP connect failed: #{e.message}") : redirect_to(integrations_path, alert: "MCP connect failed: #{e.message}")
  end

  # DELETE /mcp_servers/:id
  def destroy
    server = McpServer.find_by!(id: params[:id], organization_id: current_tenant.id)
    server.update(status: "disconnected", access_token: nil, refresh_token: nil)
    sync_agents_using(server)
    server.destroy
    head :no_content
  end

  private

  def serialize(s)
    { id: s.id, name: s.name, slug: s.slug, url: s.url, status: s.status, auth_mode: s.auth_mode,
      scopes: s.scopes, connected: s.connected?, agent_id: s.agent_id }
  end

  # What connecting `url` takes: { mode: "none" }, { mode: "oauth", meta: }
  # or { mode: "token" }. OAuth also needs a client id — the caller's, or one
  # issued by dynamic registration; with neither, the only way in is a token.
  # Raises Mcp::Oauth::Unreachable for a dead URL.
  def resolve_auth(url, transport: transport_for(url), client_id: nil)
    probe = Mcp::Oauth.probe(url, transport: transport)
    return { mode: "none" } if probe[:auth] == :none

    meta = Mcp::Oauth.discover(url, resource_metadata: probe[:resource_metadata])
    oauth_ok = client_id.present? || meta[:registration_endpoint].present?
    oauth_ok ? { mode: "oauth", meta: meta } : { mode: "token" }
  rescue Mcp::Oauth::Unreachable
    raise
  rescue StandardError
    { mode: "token" }
  end

  # Upsert the server row with its discovered endpoints and a client id —
  # the caller's, else a dynamically registered one (re-registered whenever
  # the auth server changes, since client ids don't carry across issuers).
  def setup_oauth_server!(slug, name:, url:, transport:, meta:, proposal:, client_id: nil)
    server = upsert_server(slug, name: name, url: url, proposal: proposal)
    client_id = client_id.presence
    client_id ||= server.client_id if server.client_id.present? && server.issuer == meta[:issuer]
    client_id ||= Mcp::Oauth.register_client(meta[:registration_endpoint], redirect_uri: callback_mcp_servers_url)
    server.update!(
      transport:          transport,
      auth_mode:          "oauth",
      client_id:          client_id,
      scopes:             meta[:scopes],
      issuer:             meta[:issuer],
      authorize_endpoint: meta[:authorize_endpoint],
      token_endpoint:     meta[:token_endpoint],
      status:             server.connected? ? server.status : "disconnected",
    )
    server
  end

  # Find-or-build the org's row for this slug. A server connected from an
  # agent's chat is scoped to that agent; if a second agent connects the same
  # one it widens to the whole workspace rather than stranding either agent.
  def upsert_server(slug, name:, url:, proposal:)
    server = McpServer.find_or_initialize_by(organization_id: current_tenant.id, slug: slug)
    server.name = name.presence || server.name.presence || URI(url).host
    server.url = url
    if server.new_record?
      server.agent_id = proposal&.agent_id
    elsif server.agent_id && server.agent_id != proposal&.agent_id
      server.agent_id = nil
    end
    server
  end

  def start_oauth(server, popup:, approval_token: nil)
    state = SecureRandom.urlsafe_base64(32)
    verifier, challenge = Mcp::Oauth.pkce_pair
    session[:mcp_oauth] = {
      "server_id" => server.id, "state" => state, "code_verifier" => verifier, "org_id" => current_tenant.id,
      "popup" => popup, "approval_token" => approval_token
    }
    redirect_to Mcp::Oauth.authorize_url(server, redirect_uri: callback_mcp_servers_url, state: state, code_challenge: challenge),
                allow_other_host: true
  end

  # A server just became usable: make the agents re-read their servers, and
  # if a chat card asked for it, resolve that proposal — publishing
  # "connected" resumes the agent's work with the new tools.
  def connected!(server, proposal)
    sync_agents_using(server)
    return unless proposal

    proposal.update!(status: "approved", decision: "connected", reviewed_by: current_user, reviewed_at: Time.current)
    proposal.publish_decision!
  rescue => e
    Rails.logger.warn("MCP connect: couldn't resolve proposal #{proposal&.id}: #{e.message}")
  end

  def pending_proposal(token)
    return nil if token.blank?
    PendingApproval.find_by(organization_id: current_tenant.id, approval_token: token,
                            payload_type: "connection_proposal", status: "pending")
  end

  # The OAuth popup's last page: tell the chat card how it went, then close.
  # Posted to the opener and on a BroadcastChannel — a provider that sets
  # Cross-Origin-Opener-Policy severs window.opener during consent, and the
  # channel still reaches the chat tab.
  def render_popup_result(ok:, server: nil, error: nil, approval_token: nil)
    payload = { type: "sentrel:mcp_oauth", ok: ok, name: server&.name, error: error&.to_s&.first(300),
                approvalToken: approval_token }
    message = ok ? "#{server.name} is connected. You can close this window." : "Couldn't connect: #{error}"
    render layout: false, html: <<~HTML.html_safe
      <!doctype html>
      <html><head><meta charset="utf-8"><title>#{ok ? "Connected" : "Connection failed"}</title></head>
      <body style="font: 14px/1.5 system-ui, sans-serif; padding: 32px; color: #333">
        <p>#{ERB::Util.html_escape(message)}</p>
        <script>
          (function () {
            var msg = #{ERB::Util.json_escape(payload.to_json)};
            try { new BroadcastChannel("sentrel:mcp_oauth").postMessage(msg); } catch (e) {}
            if (window.opener) window.opener.postMessage(msg, window.location.origin);
            window.close();
          })();
        </script>
      </body></html>
    HTML
  end

  # The server's URL, if it's one we'll connect to: https to a public host.
  # Connecting makes both Rails and the agent's engine call this URL, so
  # anything resolving to a private, loopback or link-local address (the Fly
  # private network, cloud metadata) is refused. Plain http is allowed only
  # for a localhost server in development.
  def mcp_url(raw)
    uri = URI.parse(raw.to_s.strip)
    return nil if uri.host.blank?

    if Rails.env.development? && %w[localhost 127.0.0.1].include?(uri.host)
      return %w[http https].include?(uri.scheme) ? uri.to_s : nil
    end
    return nil unless uri.scheme == "https"

    addresses = Resolv.getaddresses(uri.host)
    return nil if addresses.empty?
    return nil if addresses.any? { |a| ip = IPAddr.new(a); ip.private? || ip.loopback? || ip.link_local? || ip.to_i.zero? }
    uri.to_s
  rescue URI::InvalidURIError, IPAddr::InvalidAddressError
    nil
  end

  def invalid_url_message
    "That doesn't look like a reachable MCP server URL — it needs to be a public https:// address."
  end

  def mcp_slug(raw)
    slug = raw.to_s.parameterize(separator: "_").first(30).presence || "mcp"
    RESERVED_SLUGS.include?(slug) ? "#{slug}_mcp" : slug
  end

  # Remote MCPs speak streamable HTTP; a URL ending in /sse is the older
  # HTTP+SSE transport.
  def transport_for(url)
    URI(url).path.to_s.chomp("/").end_with?("/sse") ? "sse" : "http"
  end

  # Roll the Fly machines of agents that can see this server so the engine
  # re-reads the connection on its next run.
  def sync_agents_using(server)
    scope = Agent.where(organization_id: server.organization_id)
    scope = scope.where(id: server.agent_id) if server.agent_id
    scope.find_each { |a| EngineSync.trigger(a) rescue nil }
  end

  # Sanity-check a Meta access token before accepting it: one Graph API `/me`
  # call proves it's live. Works for tokens from ANY app (ours or a customer's
  # own — the BYO-app path), since the token authenticates itself. Returns a
  # user-facing error string, or nil when the token is good. Fails OPEN on
  # network trouble — a Graph blip shouldn't block connecting.
  def meta_token_error(token)
    Meta::FacebookLogin.get_json("/#{Meta::FacebookLogin.graph_version}/me", access_token: token)
    nil
  rescue Meta::FacebookLogin::Error => e
    return nil unless e.message.include?("meta 4") # only reject on 4xx (bad token); fail open otherwise
    "That token was rejected by Meta (#{e.message[0, 120]}). Regenerate it and check the scopes."
  rescue StandardError
    nil
  end
end
