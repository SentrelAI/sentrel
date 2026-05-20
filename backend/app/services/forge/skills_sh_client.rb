module Forge
  # Thin wrapper around the skills.sh public API. Used by Bootstrap to
  # pre-warm the local skill library with real, battle-tested skills from
  # the public marketplace (8000+ available) and by TemplatePack to find
  # missing skills referenced by a template before falling back to
  # generation.
  #
  # Auth: set SKILLS_SH_API_KEY to a Bearer token (request one from
  # skills-api@vercel.com). Without a key, `list` and `search` raise; `get`
  # falls back to raw.githubusercontent.com — works for any public repo.
  class SkillsShClient
    BASE = "https://skills.sh/api/v1"
    RAW_GITHUB = "https://raw.githubusercontent.com"

    class Error < StandardError; end

    def self.list(view: "trending", per_page: 50, page: 0)
      get_json("#{BASE}/skills", view: view, per_page: per_page, page: page)
    end

    def self.search(query, limit: 10)
      get_json("#{BASE}/skills/search", q: query, limit: limit)
    end

    # Returns the full skill manifest (files array). The `source` arg is the
    # `owner/repo` GitHub coordinate; `slug` is the skill name inside that
    # repo. When SKILLS_SH_API_KEY is unset we fetch the SKILL.md directly
    # from raw.githubusercontent.com — file list is best-effort (just the
    # one file).
    def self.get(source:, slug:)
      api_key = ENV["SKILLS_SH_API_KEY"]
      if api_key.present?
        return get_json("#{BASE}/skills/#{source}/#{slug}")
      end
      raw_github_fallback(source: source, slug: slug)
    end

    def self.get_json(url, **query)
      api_key = ENV["SKILLS_SH_API_KEY"]
      raise Error, "SKILLS_SH_API_KEY not set" if api_key.blank?

      uri = URI.parse(url)
      uri.query = URI.encode_www_form(query) if query.any?
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = true
      http.read_timeout = 30
      req = Net::HTTP::Get.new(uri.request_uri)
      req["Authorization"] = "Bearer #{api_key}"
      req["Accept"] = "application/json"
      res = http.request(req)
      raise Error, "skills.sh #{res.code}: #{res.body[0, 200]}" unless res.is_a?(Net::HTTPSuccess)
      JSON.parse(res.body)
    end

    # Public skills repos can be scraped without auth. We try main then
    # master, and look in the canonical .curated/ subdirectory first, then
    # the repo root.
    def self.raw_github_fallback(source:, slug:)
      paths_to_try = [
        "#{source}/main/skills/.curated/#{slug}/SKILL.md",
        "#{source}/main/skills/#{slug}/SKILL.md",
        "#{source}/main/#{slug}/SKILL.md",
        "#{source}/master/skills/.curated/#{slug}/SKILL.md",
        "#{source}/master/#{slug}/SKILL.md",
      ]
      paths_to_try.each do |path|
        url = "#{RAW_GITHUB}/#{path}"
        body = fetch_raw(url)
        next unless body
        return {
          "id" => "#{source}/#{slug}",
          "source" => source,
          "slug" => slug,
          "files" => [{ "path" => "SKILL.md", "contents" => body }],
        }
      end
      raise Error, "skills.sh skill not found via raw GitHub fallback: #{source}/#{slug}"
    end

    def self.fetch_raw(url)
      uri = URI.parse(url)
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = true
      http.read_timeout = 15
      res = http.request(Net::HTTP::Get.new(uri.request_uri))
      res.is_a?(Net::HTTPSuccess) ? res.body : nil
    rescue StandardError
      nil
    end
  end
end
