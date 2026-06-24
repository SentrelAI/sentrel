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
    # Transient infra failure (network blip / upstream 5xx) that survived
    # retries. Distinct from "not connected" so the agent retries later instead
    # of telling the user to reconnect a connection that's actually fine.
    class Transient < StandardError; end
    # The provider rejected the token (401) — the connection is broken (revoked
    # / refresh failed). The user must reconnect. We mark the Integration so the
    # UI + health job know, and the agent surfaces a reconnect prompt.
    class AuthExpired < StandardError; end
    # Provider rate limit. Carries when it's safe to try again.
    class RateLimited < StandardError
      attr_reader :retry_after
      def initialize(msg, retry_after: nil)
        super(msg)
        @retry_after = retry_after
      end
    end

    MAX_RESPONSE_BYTES = 1_000_000 # 1MB — proxy buffers through Rails, don't OOM.
    OPEN_TIMEOUT = 5
    READ_TIMEOUT = 30

    # Retry transient failures so a momentary blip never surfaces to the agent.
    MAX_ATTEMPTS = 3
    RETRYABLE_STATUSES = [ 502, 503, 504 ].freeze
    RETRYABLE_ERRORS = [
      Net::OpenTimeout, Net::ReadTimeout, Errno::ECONNRESET, Errno::ECONNREFUSED,
      Errno::EHOSTUNREACH, EOFError, SocketError, IOError
    ].freeze

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

      started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      result =
        if integration.byo_token?
          call_direct(agent, integration, verb, path, query, body)
        else
          call_nango(integration, verb, path, query, body)
        end

      audit(agent, integration, verb, path, result, status: "success", latency_ms: elapsed_ms(started))
      result
    rescue Forbidden, ApprovalRequired
      raise
    rescue => e
      audit(agent, integration, verb, path, nil, status: "error", error: e.message,
            error_kind: e.class.name.split("::").last, latency_ms: elapsed_ms(started))
      raise
    end

    def elapsed_ms(started)
      return nil unless started
      ((Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1000).round
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
      check_rate_limit!(res, integration.service_name)
      check_auth!(res, integration)
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
      check_rate_limit!(res, integration.service_name)
      check_auth!(res, integration)
      cred.use! if cred.respond_to?(:use!)
      Result.new(status: res.code.to_i, body: capped_body(res), source: "byo_token")
    end

    # ── HTTP helpers ──────────────────────────────────────────────────────────

    def build_uri(base, prefix, path, query)
      clean = path.to_s.sub(%r{\A/+}, "")
      joined = [ base.to_s.chomp("/"), prefix, clean ].compact.reject(&:empty?).join("/")
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

    # Perform the HTTP call, retrying transient failures (network errors +
    # upstream 5xx) with exponential backoff. A blip never reaches the agent.
    def perform(uri, req)
      attempt = 0
      begin
        attempt += 1
        res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == "https",
                              open_timeout: OPEN_TIMEOUT, read_timeout: READ_TIMEOUT) do |http|
          http.request(req)
        end
        if RETRYABLE_STATUSES.include?(res.code.to_i) && attempt < MAX_ATTEMPTS
          sleep(backoff(attempt))
          raise Retry
        end
        res
      rescue Retry
        retry
      rescue *RETRYABLE_ERRORS => e
        if attempt < MAX_ATTEMPTS
          sleep(backoff(attempt))
          retry
        end
        raise Transient, "upstream unreachable after #{attempt} attempts: #{e.class}"
      end
    end

    # Internal-only sentinel to re-enter the retry loop on a retryable status.
    class Retry < StandardError; end

    def backoff(attempt)
      (0.4 * (2**(attempt - 1))).clamp(0.4, 3.0)
    end

    # Raise RateLimited when the provider says we're throttled, so the agent
    # waits instead of hammering. Honors Retry-After and x-ratelimit-reset.
    def check_rate_limit!(res, provider)
      code = res.code.to_i
      remaining = res["x-ratelimit-remaining"]
      throttled = code == 429 || (code == 403 && remaining.to_s == "0")
      return unless throttled
      retry_after =
        if res["retry-after"].present?
          res["retry-after"].to_i
        elsif res["x-ratelimit-reset"].present?
          [ res["x-ratelimit-reset"].to_i - Time.now.to_i, 0 ].max
        end
      raise RateLimited.new("#{provider} rate limited", retry_after: retry_after)
    end

    # A 401 means the provider rejected the token. Signal the agent (reconnect),
    # but do NOT flip the DB status here — a single transient/edge 401 would then
    # block EVERY subsequent call as "not connected" until reconnect. The health
    # job (which confirms via Nango get_connection) is the authority on marking a
    # connection broken; the next call simply tries again.
    def check_auth!(res, integration)
      return unless res.code.to_i == 401
      raise AuthExpired, "#{integration.service_name} connection rejected (401) — reconnect needed"
    end

    def capped_body(res)
      raw = res.body.to_s.byteslice(0, MAX_RESPONSE_BYTES)
      JSON.parse(raw)
    rescue JSON::ParserError
      raw
    end

    # ── audit ─────────────────────────────────────────────────────────────────

    def audit(agent, integration, verb, path, result, status:, error: nil, error_kind: nil, latency_ms: nil)
      AuditLog.create!(
        organization_id: agent.organization_id,
        agent_id: agent.id,
        action: "nango_proxy",
        tool_name: "nango.request",
        input: { provider: integration.service_name, method: verb, path: path, mode: integration.connect_mode },
        output: { status: result&.status, error: error, error_kind: error_kind, latency_ms: latency_ms }.compact,
        status: status,
      )
    rescue => e
      Rails.logger.warn "Nango::Proxy audit failed: #{e.message}"
    end
  end
end
