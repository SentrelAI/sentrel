require "net/http"
require "json"

module Nango
  # Executes a provider API call on behalf of an agent. Two routes:
  #
  #   managed / byo_oauth → Nango /proxy endpoint. Nango injects the fresh
  #     provider access token (auto-refreshed) and forwards. We never see it.
  #   byo_token           → the user pasted a key; resolve the Credential and
  #     call the provider API directly with it.
  #
  # Enforces, in order:
  #   1. Per-agent ACL (AgentToolPolicy) by HTTP verb — read vs write.
  #   2. The approval gate (mirrors /api/secrets) — writes to gated providers
  #      raise ApprovalRequired until the human approves.
  # Then dispatches, caps the response, and writes an AuditLog row.
  module Proxy
    module_function

    class Forbidden < StandardError; end
    class ApprovalRequired < StandardError; end

    MAX_RESPONSE_BYTES = 1_000_000 # 1MB — proxy buffers through Rails, don't OOM.
    OPEN_TIMEOUT = 5
    READ_TIMEOUT = 30

    Result = Struct.new(:status, :body, :source, keyword_init: true)

    # agent       : Agent making the call
    # integration : the connected Integration row (service_name = provider slug)
    # method      : "GET" | "POST" | ...
    # path        : provider API path (relative), e.g. "/user" or "v1/invoices"
    # query/body  : optional
    # approved    : set true once the human has approved a gated write
    def call(agent:, integration:, method:, path:, query: {}, body: nil, approved: false)
      provider = integration.service_name
      verb = method.to_s.upcase

      enforce_acl!(agent, provider, verb)
      if requires_approval?(integration, verb) && !approved
        raise ApprovalRequired, "approval required for #{verb} #{provider}"
      end

      result =
        if integration.byo_token?
          call_direct(agent, integration, verb, path, query, body)
        else
          call_nango(integration, verb, path, query, body)
        end

      audit(agent, integration, verb, path, result, status: "success")
      result
    rescue Forbidden, ApprovalRequired
      raise
    rescue => e
      audit(agent, integration, verb, path, nil, status: "error", error: e.message)
      raise
    end

    # A write to a gated provider (Meta/LinkedIn/TikTok) needs human approval,
    # mirroring the high-risk gate on /api/secrets. Reads never gate.
    def requires_approval?(integration, verb)
      return false if %w[GET HEAD OPTIONS].include?(verb.to_s.upcase)
      entry = IntegrationCatalog.find(integration.service_name)
      entry && entry[:review] == "gated"
    end

    # ── ACL ─────────────────────────────────────────────────────────────────

    def enforce_acl!(agent, provider, verb)
      policy = AgentToolPolicy.find_by(agent_id: agent.id, toolkit_slug: provider)
      return if policy.nil? # no row → historical default (read_write): allow.
      return if policy.allows_http_method?(verb)
      raise Forbidden, "agent policy for #{provider} forbids #{verb}"
    end

    # ── dispatch: managed / byo_oauth via Nango proxy ─────────────────────────

    def call_nango(integration, verb, path, query, body)
      uri = build_uri(Nango::Client.base_url, "proxy", path, query)
      req = http_request(verb, uri, body)
      req["Authorization"]      = "Bearer #{Nango::Client.secret_key}"
      req["Connection-Id"]      = integration.nango_connection_id.to_s
      req["Provider-Config-Key"] = integration.provider_config_key.to_s
      res = perform(uri, req)
      Result.new(status: res.code.to_i, body: capped_body(res), source: integration.connect_mode)
    end

    # ── dispatch: byo_token directly to the provider ──────────────────────────

    def call_direct(agent, integration, verb, path, query, body)
      entry = IntegrationCatalog.find(integration.service_name)
      raise Forbidden, "unknown provider #{integration.service_name}" unless entry
      cred = Credential.find_for(agent, provider: integration.service_name, kind: "generic")
      token = cred&.value
      raise Forbidden, "no pasted token for #{integration.service_name}" if token.blank?

      uri = build_uri(entry[:api_base_url], nil, path, query)
      req = http_request(verb, uri, body)
      req["Authorization"] = "Bearer #{token}"
      res = perform(uri, req)
      cred.use! if cred.respond_to?(:use!)
      Result.new(status: res.code.to_i, body: capped_body(res), source: "byo_token")
    end

    # ── HTTP helpers ──────────────────────────────────────────────────────────

    def build_uri(base, prefix, path, query)
      clean = path.to_s.sub(%r{\A/+}, "")
      joined = [base.to_s.chomp("/"), prefix, clean].compact.reject(&:empty?).join("/")
      uri = URI(joined)
      uri.query = URI.encode_www_form(query) if query.present?
      uri
    end

    def http_request(verb, uri, body)
      klass = {
        "GET" => Net::HTTP::Get, "POST" => Net::HTTP::Post, "PUT" => Net::HTTP::Put,
        "PATCH" => Net::HTTP::Patch, "DELETE" => Net::HTTP::Delete, "HEAD" => Net::HTTP::Head
      }.fetch(verb) { raise Forbidden, "unsupported method #{verb}" }
      req = klass.new(uri)
      if body.present? && !%w[GET HEAD].include?(verb)
        req["Content-Type"] = "application/json"
        req.body = body.is_a?(String) ? body : body.to_json
      end
      req
    end

    def perform(uri, req)
      Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == "https",
                      open_timeout: OPEN_TIMEOUT, read_timeout: READ_TIMEOUT) do |http|
        http.request(req)
      end
    end

    def capped_body(res)
      raw = res.body.to_s.byteslice(0, MAX_RESPONSE_BYTES)
      JSON.parse(raw)
    rescue JSON::ParserError
      raw
    end

    # ── audit ─────────────────────────────────────────────────────────────────

    def audit(agent, integration, verb, path, result, status:, error: nil)
      AuditLog.create!(
        organization_id: agent.organization_id,
        agent_id: agent.id,
        action: "nango_proxy",
        tool_name: "nango.request",
        input: { provider: integration.service_name, method: verb, path: path, mode: integration.connect_mode },
        output: { status: result&.status, error: error }.compact,
        status: status,
      )
    rescue => e
      Rails.logger.warn "Nango::Proxy audit failed: #{e.message}"
    end
  end
end
