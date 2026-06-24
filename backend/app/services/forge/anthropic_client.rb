require "net/http"
require "json"

# Thin Anthropic HTTP client shared by the Forge services. One method, sync.
# Threads call it concurrently to drive parallel template / skill generation
# without pulling in async-http or a connection pool — Net::HTTP is fine for
# the few-dozen concurrent calls Forge fires off, and the API rate-limits
# us long before we'd benefit from keepalive.
#
# Retry + cost logging:
#   - 429 → honor `retry-after` header, sleep min(value, 30s).
#   - 5xx → exponential backoff 1s → 2s → 4s.
#   - Up to 3 attempts total.
#   - On 200 we log input/output tokens to Rails.logger.info AND accumulate
#     them in Forge::AnthropicClient.usage_total — Bootstrap reads that at
#     the end of a run for a single-line cost summary.
module Forge
  class AnthropicClient
    URL = URI.parse("https://api.anthropic.com/v1/messages").freeze

    DEFAULT_MODEL = "claude-sonnet-4-6"
    DEFAULT_MAX_TOKENS = 4096
    # Anthropic's stable /v1/messages version. They DO publish dated versions
    # but `2023-06-01` remains the canonical one — any other value the model
    # router doesn't know returns 400. Earlier this constant said
    # "2024-09-15" which silently broke every Forge Claude call until the
    # analyzer's rescue swallowed it.
    ANTHROPIC_VERSION = "2023-06-01".freeze

    MAX_ATTEMPTS = 3
    MAX_RETRY_AFTER = 30 # seconds — cap whatever the server asks
    BACKOFF_5XX = [ 1, 2, 4 ].freeze

    class Error < StandardError; end

    # Process-wide token counters. Thread-safe; we accumulate from any of the
    # 20 parallel orchestrator threads.
    @input_tokens  = Concurrent::AtomicFixnum.new(0)
    @output_tokens = Concurrent::AtomicFixnum.new(0)
    @call_count    = Concurrent::AtomicFixnum.new(0)

    class << self
      def usage_total
        {
          input_tokens: @input_tokens.value,
          output_tokens: @output_tokens.value,
          calls: @call_count.value
        }
      end

      def reset_usage!
        @input_tokens.value  = 0
        @output_tokens.value = 0
        @call_count.value    = 0
      end
    end

    # Per-request read timeout. 120s accommodates long completions
    # (instructions_md sections, multi-file SKILL.md output) without the
    # Net::HTTP read raising mid-stream. The outer Orchestrator
    # JOB_TIMEOUT still caps total wall time for a TemplatePack.
    def self.complete(prompt:, model: DEFAULT_MODEL, max_tokens: DEFAULT_MAX_TOKENS, system: nil, timeout: 120)
      api_key = ENV["ANTHROPIC_API_KEY"]
      raise Error, "ANTHROPIC_API_KEY not set" if api_key.blank?

      body = {
        model: model,
        max_tokens: max_tokens,
        messages: [ { role: "user", content: prompt } ]
      }
      body[:system] = system if system.present?

      attempt = 0
      loop do
        attempt += 1
        response = http_post(api_key: api_key, body: body, timeout: timeout)
        code = response.code.to_i

        if code == 200
          parsed = JSON.parse(response.body)
          record_usage!(parsed, model)
          return parsed.dig("content", 0, "text").to_s
        end

        if code == 429 && attempt < MAX_ATTEMPTS
          delay = retry_after_seconds(response) || (2**attempt)
          Rails.logger.warn "[Forge] Anthropic 429 (attempt #{attempt}/#{MAX_ATTEMPTS}) — sleeping #{delay}s"
          sleep(delay)
          next
        end

        if code >= 500 && code < 600 && attempt < MAX_ATTEMPTS
          delay = BACKOFF_5XX[attempt - 1] || 4
          Rails.logger.warn "[Forge] Anthropic #{code} (attempt #{attempt}/#{MAX_ATTEMPTS}) — sleeping #{delay}s"
          sleep(delay)
          next
        end

        # Non-retryable, or out of attempts.
        parsed = JSON.parse(response.body) rescue {}
        raise Error, "Anthropic #{code}: #{parsed.dig('error', 'message') || response.body[0, 200]}"
      end
    end

    # Parse a Claude response that we asked to be JSON. Strips ``` fences if
    # the model wrapped them anyway, then JSON.parse. Returns the parsed hash
    # or raises Error on garbage.
    def self.parse_json(text)
      stripped = text.to_s.strip
      stripped = stripped.sub(/\A```(?:json)?\s*/, "").sub(/\s*```\z/, "") if stripped.start_with?("```")
      # Trim any leading prose before the first '{' or '['
      if (idx = stripped.index(/[\[{]/))
        stripped = stripped[idx..]
      end
      JSON.parse(stripped)
    rescue JSON::ParserError => e
      raise Error, "JSON parse failed: #{e.message}; raw=#{text[0, 200].inspect}"
    end

    # ── private-ish ─────────────────────────────────────────────────────

    def self.http_post(api_key:, body:, timeout:)
      http = Net::HTTP.new(URL.host, URL.port)
      http.use_ssl = true
      http.read_timeout = timeout
      http.open_timeout = 15

      request = Net::HTTP::Post.new(URL.path)
      request["Content-Type"] = "application/json"
      request["x-api-key"] = api_key
      request["anthropic-version"] = ANTHROPIC_VERSION
      request.body = body.to_json
      http.request(request)
    end

    # Some 429 responses include Retry-After (in seconds, integer string).
    def self.retry_after_seconds(response)
      raw = response["retry-after"].to_s.strip
      return nil if raw.empty?
      n = raw.to_i
      n > 0 ? [ n, MAX_RETRY_AFTER ].min : nil
    end

    def self.record_usage!(parsed, model)
      usage = parsed["usage"] || {}
      input = usage["input_tokens"].to_i
      output = usage["output_tokens"].to_i
      return if input.zero? && output.zero?
      @input_tokens.update { |v| v + input }
      @output_tokens.update { |v| v + output }
      @call_count.increment
      Rails.logger.info "[Forge] tokens in/out: #{input}/#{output} model=#{model}"
    end
  end
end
