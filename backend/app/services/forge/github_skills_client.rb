module Forge
  # No-API-key skill discovery via the public GitHub API.
  #
  # GitHub doesn't need anyone to issue you a key — set GH_TOKEN to a
  # personal access token (github.com/settings/tokens → "Generate new
  # token (classic)" → only the `public_repo` scope) to raise the rate
  # limit from 60/hr to 5000/hr. Without a token, unauthenticated reads
  # still work — fine for occasional one-offs, not for a full bootstrap.
  #
  # API surface:
  #   search(query)              → array of repo+path candidates
  #   get_skill(owner, repo, path) → manifest hash compatible with SkillIngestor
  class GithubSkillsClient
    API = "https://api.github.com"
    RAW = "https://raw.githubusercontent.com"

    class Error < StandardError; end

    # GitHub's /search/code endpoint REQUIRES authentication — unauthenticated
    # calls return 422. We emit one big warning the first time anyone tries
    # to use it without a token, then short-circuit silently so we don't spam
    # the log with one warning per template lookup.
    @token_check_mutex = Mutex.new
    @token_check_done  = false
    @token_present     = false

    def self.token_available?
      @token_check_mutex.synchronize do
        return @token_present if @token_check_done
        @token_check_done = true
        @token_present = ENV["GH_TOKEN"].present?
        unless @token_present
          Rails.logger.warn "[Forge] " + ("─" * 76)
          Rails.logger.warn "[Forge] GH_TOKEN not set — GitHub Search source DISABLED."
          Rails.logger.warn "[Forge] GitHub's /search/code endpoint requires auth (returns 422 without it)."
          Rails.logger.warn "[Forge] Skills will fall through from GitHub → SkillGenerator (slower + costs"
          Rails.logger.warn "[Forge]   more in Claude tokens). Fix: create a PAT at"
          Rails.logger.warn "[Forge]   github.com/settings/tokens (Classic, public_repo scope), set as"
          Rails.logger.warn "[Forge]   GH_TOKEN in your env. Then re-run."
          Rails.logger.warn "[Forge] " + ("─" * 76)
        end
        @token_present
      end
    end

    # Search public repos for `SKILL.md` matching the query terms. Returns
    # an array of { source, slug, path, html_url } candidates, ranked by
    # GitHub's score (which weighs match quality, stars, and freshness).
    def self.search(query, limit: 5)
      return [] unless token_available?
      q = "#{query} filename:SKILL.md"
      data = get_json("#{API}/search/code", { q: q, per_page: limit })
      Array(data["items"]).first(limit).map do |item|
        path = item["path"].to_s
        # Skill "slug" is the parent directory name of the SKILL.md file.
        slug = File.basename(File.dirname(path))
        slug = nil if slug == "." || slug == "/" # SKILL.md at repo root
        {
          "source" => item.dig("repository", "full_name"),
          "slug"   => slug,
          "path"   => path,
          "html_url" => item["html_url"],
          "stars"  => item.dig("repository", "stargazers_count"),
        }
      end
    end

    # Fetch a SKILL.md + every sibling file in the same directory. Returns
    # a manifest with the same shape as skills.sh's GET /skills/{src}/{slug}
    # so SkillIngestor can consume it without any branching.
    def self.get_skill(source:, path:)
      owner, repo = source.to_s.split("/", 2)
      raise Error, "invalid source: #{source}" if owner.blank? || repo.blank?

      # Resolve the default branch so raw URLs work for repos that use
      # `main` AND for the long tail still on `master`.
      branch = default_branch(owner: owner, repo: repo)
      dir = File.dirname(path)
      dir = "" if dir == "."

      # List sibling files via the Contents API, then fetch each via raw.
      contents = list_dir(owner: owner, repo: repo, dir: dir, branch: branch)
      files = contents.select { |c| c["type"] == "file" }.map do |c|
        body = fetch_raw("#{RAW}/#{owner}/#{repo}/#{branch}/#{c["path"]}")
        next nil if body.nil?
        { "path" => File.basename(c["path"]), "contents" => body }
      end.compact

      raise Error, "no files found at #{source}/#{dir}" if files.empty?

      {
        "id" => "#{source}/#{File.basename(dir)}",
        "source" => source,
        "slug" => File.basename(dir),
        "files" => files,
      }
    end

    def self.default_branch(owner:, repo:)
      data = get_json("#{API}/repos/#{owner}/#{repo}")
      data["default_branch"].presence || "main"
    rescue Error
      "main"
    end

    def self.list_dir(owner:, repo:, dir:, branch:)
      url = "#{API}/repos/#{owner}/#{repo}/contents/#{dir}"
      data = get_json(url, ref: branch)
      Array(data)
    end

    def self.get_json(url, query = {})
      uri = URI.parse(url)
      uri.query = URI.encode_www_form(query) if query.any?
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = true
      http.read_timeout = 20
      req = Net::HTTP::Get.new(uri.request_uri)
      req["Accept"] = "application/vnd.github+json"
      req["X-GitHub-Api-Version"] = "2022-11-28"
      req["User-Agent"] = "alchemy-forge"
      if (token = ENV["GH_TOKEN"]).present?
        req["Authorization"] = "Bearer #{token}"
      end
      res = http.request(req)
      raise Error, "github #{res.code}: #{res.body[0, 200]}" unless res.is_a?(Net::HTTPSuccess)
      JSON.parse(res.body)
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
