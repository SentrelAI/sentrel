module Forge
  # Resolves a capability requirement to a real SkillDefinition row.
  #
  # Resolution chain (first hit wins):
  #   1. Local DB — ILIKE-OR over the query tokens against name/description/
  #      skill_md. Cheap, hits if we already have a matching skill.
  #   2. skills.sh — paid marketplace, 8420 skills with multi-file packages.
  #      Skipped if SKILLS_SH_API_KEY is unset.
  #   3. GitHub Search — `q=<query> filename:SKILL.md`. Self-service auth via
  #      GH_TOKEN (PAT, 30s to create). 60/hr unauth, 5000/hr with PAT.
  #   4. SkillGenerator — Claude writes one fresh from the requirement.
  #
  # Process-wide cache so 30 templates that all need "send Gmail" only
  # resolve it once per bootstrap run. Thread-safe via Concurrent::Map.
  class SkillResolver
    Result = Struct.new(:skill, :requirement, :via, :error, :would_generate, keyword_init: true) do
      def ok? = error.nil? && (skill.present? || would_generate)
    end

    CACHE = Concurrent::Map.new
    CACHE_MUTEX = Mutex.new

    def self.reset_cache!
      CACHE.clear
    end

    def initialize(requirement:, allow_generate: true, dry_run: false)
      @requirement = requirement
      @allow_generate = allow_generate
      # dry_run = preview mode for the AI Template Creator. We still
      # consult the local DB + remote sources (read-only), but we skip:
      #   - SkillGenerator's Claude call (just report "would generate")
      #   - ensure_composio_link! mutation
      # Cache is bypassed in dry_run so an earlier real-commit doesn't
      # mask what would happen on a fresh run.
      @dry_run = dry_run
    end

    def call
      return resolve_uncached if @dry_run # preview mode bypasses the cache

      cache_key = @requirement.query.downcase
      cached = CACHE[cache_key]
      return cached if cached&.ok?

      CACHE_MUTEX.synchronize do
        # Re-check after acquiring lock to avoid double-resolution.
        cached = CACHE[cache_key]
        return cached if cached&.ok?

        result = resolve_uncached
        CACHE[cache_key] = result
        result
      end
    end

    private

    def resolve_uncached
      skill, via = nil, nil

      if (hit = try_local)
        skill, via = hit, "local"
      elsif ENV["SKILLS_SH_API_KEY"].present? && (hit = try_skills_sh_for_dry_run_or_real)
        skill, via = hit, "skills.sh"
      elsif (hit = try_github_for_dry_run_or_real)
        skill, via = hit, "github"
      elsif @allow_generate
        if @dry_run
          # Don't fire Claude for a preview — just report what WOULD happen.
          return Result.new(requirement: @requirement, via: "would_generate", would_generate: true)
        end
        if (hit = try_generate)
          skill, via = hit, "generated"
        end
      end

      return Result.new(requirement: @requirement, error: "no source produced a matching skill") unless skill

      # Composio toolkit linkage: backfill the toolkit slug onto the resolved
      # skill so /integrations + AgentTemplate#missing_integrations_for see
      # the right "Connect X" hint. SKIPPED in dry_run to avoid mutating
      # real skill rows during a preview.
      ensure_composio_link!(skill, @requirement.composio_toolkit) if @requirement.composio_toolkit.present? && !@dry_run

      Result.new(skill: skill, requirement: @requirement, via: via)
    rescue => e
      Result.new(requirement: @requirement, error: e.message)
    end

    # Wrappers around the original try_* methods. For dry_run we want
    # to consult sources but SkillIngestor mutates the DB when it
    # imports a manifest. So in dry_run, we only check local DB and
    # treat any miss as "would generate" rather than ingesting.
    def try_skills_sh_for_dry_run_or_real
      @dry_run ? nil : try_skills_sh
    end

    def try_github_for_dry_run_or_real
      @dry_run ? nil : try_github
    end

    def ensure_composio_link!(skill, toolkit)
      current = Array(skill.requires_connections).map(&:to_s)
      return if current.include?(toolkit)
      skill.update!(requires_connections: current + [ toolkit ])
    end

    # ── 1. Local match ──────────────────────────────────────────────────
    def try_local
      tokens = meaningful_tokens(@requirement.query)
      return nil if tokens.empty?

      # Build "x ILIKE ? OR y ILIKE ? OR ..." across name + description.
      conditions = []
      values = []
      tokens.each do |tok|
        pat = "%#{tok}%"
        conditions << "(name ILIKE ? OR description ILIKE ? OR slug ILIKE ?)"
        values.push(pat, pat, pat)
      end
      scope = SkillDefinition.where(conditions.join(" OR "), *values)
      # Score by number of token hits — closest match wins.
      ranked = scope.to_a.map { |s| [ s, score(s, tokens) ] }.sort_by { |_, sc| -sc }
      best, best_score = ranked.first
      best if best_score >= 2 || (best_score >= 1 && tokens.size == 1)
    end

    def score(skill, tokens)
      hay = "#{skill.name} #{skill.description} #{skill.slug}".downcase
      tokens.count { |t| hay.include?(t) }
    end

    def meaningful_tokens(query)
      stopwords = %w[the a an of for and or in to via with from use using send read write get post my our]
      query.to_s.downcase.scan(/[a-z][a-z0-9]{2,}/).reject { |w| stopwords.include?(w) }.uniq
    end

    # ── 2. skills.sh ────────────────────────────────────────────────────
    def try_skills_sh
      results = SkillsShClient.search(@requirement.query, limit: 3)
      Array(results["data"] || results["results"]).each do |entry|
        manifest = SkillsShClient.get(source: entry["source"], slug: entry["slug"]) rescue nil
        next unless manifest && Array(manifest["files"]).any?
        ires = SkillIngestor.new(manifest: manifest).call
        return ires.skill if ires.ok?
      end
      nil
    rescue SkillsShClient::Error => e
      Rails.logger.info "[SkillResolver] skills.sh search failed: #{e.message}"
      nil
    end

    # ── 3. GitHub Search ────────────────────────────────────────────────
    def try_github
      candidates = GithubSkillsClient.search(@requirement.query, limit: 3)
      candidates.each do |c|
        next if c["slug"].blank? # SKILL.md at repo root — not a skill bundle
        manifest = GithubSkillsClient.get_skill(source: c["source"], path: c["path"]) rescue nil
        next unless manifest && Array(manifest["files"]).any?
        ires = SkillIngestor.new(manifest: manifest).call
        return ires.skill if ires.ok?
      end
      nil
    rescue GithubSkillsClient::Error => e
      Rails.logger.info "[SkillResolver] github search failed: #{e.message}"
      nil
    end

    # ── 4. Generate ─────────────────────────────────────────────────────
    def try_generate
      brief = {
        name: @requirement.capability,
        description: @requirement.capability,
        category: infer_category,
        notes: "Generated to satisfy a template-level capability requirement."
      }
      gres = SkillGenerator.new(brief: brief, write_file: false).call
      gres.ok? ? gres.skill : nil
    end

    def infer_category
      hay = @requirement.capability.downcase
      return "sales"        if hay.match?(/sales|crm|outreach|prospect|hubspot|salesforce/)
      return "communication" if hay.match?(/email|gmail|slack|messag|chat|sms/)
      return "content"       if hay.match?(/write|content|video|image|post|design|copy/)
      return "engineering"   if hay.match?(/code|deploy|github|build|test|api/)
      return "finance"       if hay.match?(/invoice|stripe|expense|book|payment/)
      return "productivity"  if hay.match?(/calendar|notion|sheets|drive|airtable|document|task/)
      return "support"       if hay.match?(/ticket|support|customer service|help/)
      "common"
    end
  end
end
