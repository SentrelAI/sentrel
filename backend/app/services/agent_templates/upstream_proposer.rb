module AgentTemplates
  # Roll a field-tested persona edit back to the agent-templates GitHub repo
  # as a pull request. The loop this closes: template → deployed agent →
  # admin tunes the prompts in production → the improvement flows upstream
  # for every future deploy, reviewed on GitHub like any change.
  #
  #   AgentTemplates::UpstreamProposer.new(revision: rev, user: current_user).call
  #   # => "https://github.com/SentrelAI/agent-templates/pull/12"
  #
  # Needs GITHUB_TEMPLATES_TOKEN (fine-grained PAT: contents + pull-requests
  # write on the templates repo). configured? gates the UI affordance.
  class UpstreamProposer
    class Error < StandardError; end

    FIELD_FILES = {
      "identity_md"        => "identity.md",
      "personality_md"     => "personality.md",
      "instructions_md"    => "instructions.md",
      "email_signature_md" => "email-signature.md"
    }.freeze

    def self.configured? = ENV["GITHUB_TEMPLATES_TOKEN"].present?

    def initialize(revision:, user:)
      @revision = revision
      @agent    = revision.agent
      @user     = user
    end

    def call
      raise Error, "GitHub token not configured (GITHUB_TEMPLATES_TOKEN)" unless self.class.configured?
      raise Error, "This agent isn't linked to a template" if @agent.template_slug.blank?

      template = ActsAsTenant.without_tenant { AgentTemplate.find_by(slug: @agent.template_slug) }
      raise Error, "Template #{@agent.template_slug} not found" unless template
      raise Error, "Template has no GitHub source" if template.source_url.blank?

      owner, repo, base_branch, dir = parse_source(template.source_url)
      file = FIELD_FILES.fetch(@revision.field) { raise Error, "Field #{@revision.field} can't be proposed" }
      path = [ dir, file ].compact_blank.join("/")

      content = detokenize(@revision.after_text)
      branch  = "improve/#{template.slug}-#{@revision.field.delete_suffix('_md')}-#{@revision.id}"

      base_sha = api(:get, "/repos/#{owner}/#{repo}/git/ref/heads/#{base_branch}").dig("object", "sha")
      api(:post, "/repos/#{owner}/#{repo}/git/refs", { ref: "refs/heads/#{branch}", sha: base_sha })

      existing = api(:get, "/repos/#{owner}/#{repo}/contents/#{path}?ref=#{base_branch}")
      api(:put, "/repos/#{owner}/#{repo}/contents/#{path}", {
        message: "improve(#{template.slug}): #{@revision.field.delete_suffix('_md')} — field-tested edit",
        content: Base64.strict_encode64(content),
        branch: branch,
        sha: existing["sha"]
      })

      pr = api(:post, "/repos/#{owner}/#{repo}/pulls", {
        title: "improve(#{template.slug}): #{@revision.field.delete_suffix('_md')} from a live agent",
        head: branch,
        base: base_branch,
        body: pr_body(template)
      })
      url = pr["html_url"] or raise Error, "GitHub didn't return a PR URL"
      @revision.update!(proposed_pr_url: url)
      url
    end

    private

    # https://github.com/<owner>/<repo>[/tree/<ref>/<dir>] → parts.
    def parse_source(url)
      m = url.match(%r{github\.com/([^/]+)/([^/]+)(?:/tree/([^/]+)/(.+))?}) or
        raise Error, "Unrecognized source URL: #{url}"
      [ m[1], m[2].delete_suffix(".git"), m[3] || "main", m[4] ]
    end

    # Best-effort reverse of the deploy-time {{token}} substitution: the
    # agent's persona carries rendered values (org name, agent name, the
    # owner's name/email) that must not land in a public template. The PR
    # diff on GitHub is the human safety net for anything this misses.
    def detokenize(text)
      org = @agent.organization
      subs = {
        @agent.name                => "{{agent_name}}",
        org&.name                  => "{{company_name}}",
        org&.email_domain          => "{{company_domain}}",
        @user&.name                => "{{user_name}}",
        @user&.email               => "{{user_email}}"
      }
      subs.reject { |k, _| k.blank? || k.to_s.length < 3 }
          .sort_by { |k, _| -k.length }
          .reduce(text) { |acc, (val, token)| acc.gsub(val, token) }
    end

    def pr_body(template)
      <<~MD
        Field-tested persona improvement, proposed from a live agent via the platform.

        - **Template**: `#{template.slug}` (agent created from v#{@agent.template_version_number || "?"})
        - **File**: `#{FIELD_FILES[@revision.field]}`
        - **Proposed by**: #{@user&.name} (#{@user&.email})
        - **Editor's note**: #{@revision.note.presence || "—"}

        Org-specific values were re-tokenized best-effort — review the diff for anything that slipped through before merging.
      MD
    end

    def api(method, path, body = nil)
      uri = URI.parse("https://api.github.com#{path}")
      klass = { get: Net::HTTP::Get, post: Net::HTTP::Post, put: Net::HTTP::Put }.fetch(method)
      req = klass.new(uri)
      req["Authorization"] = "Bearer #{ENV['GITHUB_TEMPLATES_TOKEN']}"
      req["Accept"] = "application/vnd.github+json"
      req["X-GitHub-Api-Version"] = "2022-11-28"
      req.body = body.to_json if body
      req["Content-Type"] = "application/json" if body
      res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, open_timeout: 5, read_timeout: 20) { |h| h.request(req) }
      parsed = JSON.parse(res.body) rescue {}
      unless res.is_a?(Net::HTTPSuccess)
        raise Error, "GitHub #{method.upcase} #{path} → #{res.code}: #{parsed['message'] || res.body.to_s[0, 120]}"
      end
      parsed
    end
  end
end
