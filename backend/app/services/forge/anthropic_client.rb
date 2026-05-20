require "net/http"
require "json"

# Thin Anthropic HTTP client shared by the Forge services. One method, sync.
# Threads call it concurrently to drive parallel template / skill generation
# without pulling in async-http or a connection pool — Net::HTTP is fine for
# the few-dozen concurrent calls Forge fires off, and the API rate-limits
# us long before we'd benefit from keepalive.
module Forge
  class AnthropicClient
    URL = URI.parse("https://api.anthropic.com/v1/messages").freeze

    DEFAULT_MODEL = "claude-sonnet-4-6"
    DEFAULT_MAX_TOKENS = 4096

    class Error < StandardError; end

    def self.complete(prompt:, model: DEFAULT_MODEL, max_tokens: DEFAULT_MAX_TOKENS, system: nil, timeout: 60)
      api_key = ENV["ANTHROPIC_API_KEY"]
      raise Error, "ANTHROPIC_API_KEY not set" if api_key.blank?

      http = Net::HTTP.new(URL.host, URL.port)
      http.use_ssl = true
      http.read_timeout = timeout
      http.open_timeout = 15

      body = {
        model: model,
        max_tokens: max_tokens,
        messages: [{ role: "user", content: prompt }],
      }
      body[:system] = system if system.present?

      request = Net::HTTP::Post.new(URL.path)
      request["Content-Type"] = "application/json"
      request["x-api-key"] = api_key
      request["anthropic-version"] = "2023-06-01"
      request.body = body.to_json

      response = http.request(request)
      parsed = JSON.parse(response.body)

      unless response.is_a?(Net::HTTPSuccess)
        raise Error, "Anthropic #{response.code}: #{parsed.dig('error', 'message') || response.body[0, 200]}"
      end

      parsed.dig("content", 0, "text").to_s
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
  end
end
