require "net/http"
require "rubygems/package"
require "zlib"
require "stringio"

# Turns a bundle SOURCE into the in-memory file map Manifest expects.
# Two sources:
#
#   Fetcher.from_github("https://github.com/org/repo")                 # repo root, default branch
#   Fetcher.from_github(".../repo/tree/main/agents/sdr")               # subdir at ref
#   Fetcher.from_tarball(io)                                           # uploaded .tar.gz (npx agentmanifest deploy)
#
# GitHub fetch goes through codeload (no API token needed for public
# repos), capped at 10MB compressed. Private repos are out of scope for
# v1 — the CLI path covers them since the user tars locally.
module AgentBundles
  class Fetcher
    MAX_BYTES = 10 * 1024 * 1024
    GITHUB_URL = %r{\Ahttps://github\.com/([\w.-]+)/([\w.-]+?)(?:\.git)?(?:/tree/([^/]+)(?:/(.*))?)?/?\z}

    def self.from_github(url)
      m = GITHUB_URL.match(url.to_s.strip)
      raise FetchError, "not a GitHub repo URL (expected https://github.com/owner/repo[/tree/ref[/subdir]])" unless m
      owner, repo, ref, subdir = m.captures
      ref = ref.presence || "HEAD"

      # Cache the repo tarball briefly: the wizard fetches once for the
      # preview and again on Deploy, and repeated testing hammers
      # codeload from one server IP — GitHub rate-limits that (429).
      # 5 minutes is long enough to cover a preview→deploy round-trip,
      # short enough that a pushed fix shows up quickly.
      tarball = Rails.cache.fetch("agent_bundles:tarball:#{owner}/#{repo}@#{ref}", expires_in: 5.minutes) do
        http_get("https://codeload.github.com/#{owner}/#{repo}/tar.gz/#{ref}")
      end
      files = untar(StringIO.new(tarball))

      # codeload prefixes every path with "<repo>-<ref>/" — strip it, then
      # narrow to the requested subdir if one was given.
      files = files.map { |p, c| [ p.split("/", 2)[1], c ] }.reject { |p, _| p.nil? }.to_h
      if subdir.present?
        prefix = "#{subdir.chomp('/')}/"
        files = files.select { |p, _| p.start_with?(prefix) }.transform_keys { |p| p.delete_prefix(prefix) }
        raise FetchError, "no agent.yaml under #{subdir.inspect} in #{owner}/#{repo}" unless files.key?("agent.yaml")
      end
      files
    end

    def self.from_tarball(io)
      untar(io)
    end

    def self.http_get(url, redirects_left: 3)
      uri = URI.parse(url)
      res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, open_timeout: 5, read_timeout: 20) do |http|
        http.request(Net::HTTP::Get.new(uri.request_uri))
      end
      if res.is_a?(Net::HTTPRedirection) && redirects_left.positive?
        return http_get(res["location"], redirects_left: redirects_left - 1)
      end
      if res.code.to_i == 429
        raise FetchError, "GitHub is rate-limiting us — wait a minute and retry, or upload the bundle as a .tar.gz instead"
      end
      raise FetchError, "GitHub fetch failed: HTTP #{res.code} (repo private or ref missing?)" unless res.is_a?(Net::HTTPSuccess)
      raise FetchError, "bundle too large (>#{MAX_BYTES / 1024 / 1024}MB compressed)" if res.body.bytesize > MAX_BYTES
      res.body
    end

    # tar.gz → {path => content}. Skips directories, symlinks (path
    # traversal guard), binaries over 1MB, and dotfiles like .git/.
    def self.untar(io)
      files = {}
      Zlib::GzipReader.wrap(io) do |gz|
        Gem::Package::TarReader.new(gz) do |tar|
          tar.each do |entry|
            next unless entry.file?
            path = entry.full_name.sub(%r{\A\./}, "")
            next if path.include?("..") || path.start_with?("/")
            next if path.split("/").any? { |seg| seg.start_with?(".") }
            next if entry.size > 1024 * 1024
            files[path] = entry.read.to_s.force_encoding("UTF-8")
          end
        end
      end
      raise FetchError, "archive is empty or not a .tar.gz" if files.empty?
      files
    rescue Zlib::GzipFile::Error
      raise FetchError, "not a gzip archive (expected .tar.gz)"
    end
  end
end
