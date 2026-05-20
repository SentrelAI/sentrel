module Forge
  # Top-level driver for the 100-template factory.
  #
  # Phases:
  #   1. Pre-warm — pull top N trending skills from skills.sh (or scrape the
  #      public skill repos in KNOWN_REPOS if no API key). Ingest each into
  #      SkillDefinition + skill_files. ~50 real, battle-tested skills.
  #   2. Generate — fan out the full IdeaBank::ALL through TemplatePack at
  #      concurrency 20. Each template's missing skills get auto-resolved
  #      (skills.sh search → SkillGenerator fallback).
  #   3. Report — print summary, surface failures.
  #
  # Designed to be idempotent: re-running upserts on slug, never duplicates.
  class Bootstrap
    KNOWN_REPOS = [
      # owner/repo coordinate, plus an array of skill slugs we want to pull
      # from each. Used as the no-auth fallback when SKILLS_SH_API_KEY isn't
      # set. Keep this list short and high-quality.
      { source: "anthropics/skills",       slugs: %w[skill-creator pdf docx pptx xlsx] },
      { source: "heygen-com/hyperframes",  slugs: %w[hyperframes hyperframes-cli hyperframes-media css-animations] },
      { source: "vercel-labs/agent-skills", slugs: %w[next-js-development react-development] },
    ].freeze

    Summary = Struct.new(:skills_prewarmed, :template_results, :duration_s, keyword_init: true) do
      def successes = template_results.select(&:ok?)
      def failures  = template_results.reject(&:ok?)
      def to_s
        lines = []
        lines << "Forge::Bootstrap"
        lines << "  Pre-warmed skills: #{skills_prewarmed}"
        lines << "  Templates: #{successes.size}/#{template_results.size} ok in #{duration_s.round(1)}s"
        lines << "  Final counts: AgentTemplate=#{AgentTemplate.count}, SkillDefinition=#{SkillDefinition.count}"
        if failures.any?
          lines << "  Failures:"
          failures.each { |r| lines << "    #{r.brief.is_a?(Hash) ? r.brief[:slug] : r.brief}: #{r.error}" }
        end
        lines.join("\n")
      end
    end

    def initialize(briefs: IdeaBank::ALL, concurrency: 20, prewarm_count: 50, try_skills_sh: true)
      @briefs = briefs
      @concurrency = concurrency
      @prewarm_count = prewarm_count
      @try_skills_sh = try_skills_sh
    end

    def run
      started = Time.current
      prewarmed = prewarm_skills!
      template_results = generate_templates!
      Summary.new(skills_prewarmed: prewarmed, template_results: template_results,
                  duration_s: Time.current - started)
    end

    private

    # Phase 1.
    def prewarm_skills!
      puts "[Forge::Bootstrap] phase 1: pre-warming skill library…"
      manifests = if @try_skills_sh && ENV["SKILLS_SH_API_KEY"].present?
        list_trending_skills(limit: @prewarm_count)
      else
        puts "[Forge::Bootstrap] SKILLS_SH_API_KEY not set — using KNOWN_REPOS fallback"
        list_known_repo_skills
      end

      count = 0
      mutex = Mutex.new
      queue = Queue.new
      manifests.each { |m| queue << m }
      queue.close

      Array.new([@concurrency, manifests.size].min) do
        Thread.new do
          while (manifest = queue.pop)
            res = SkillIngestor.new(manifest: manifest).call
            mutex.synchronize do
              if res.ok?
                count += 1
                puts "[Forge::Bootstrap]   ✓ skill #{res.skill.slug}"
              else
                puts "[Forge::Bootstrap]   ✗ skill #{manifest["slug"]}: #{res.error}"
              end
            end
          end
        end
      end.each(&:join)
      count
    end

    # Phase 2.
    def generate_templates!
      puts "[Forge::Bootstrap] phase 2: generating #{@briefs.size} templates at concurrency=#{@concurrency}"
      Orchestrator.run(briefs: @briefs, generator: TemplatePack, concurrency: @concurrency).results
    end

    # Lists ~limit trending skills from skills.sh and fully fetches each one.
    def list_trending_skills(limit:)
      collected = []
      page = 0
      per_page = 50
      while collected.size < limit
        listing = SkillsShClient.list(view: "trending", per_page: per_page, page: page)
        entries = Array(listing["data"])
        break if entries.empty?
        entries.each do |entry|
          break if collected.size >= limit
          manifest = SkillsShClient.get(source: entry["source"], slug: entry["slug"]) rescue nil
          collected << manifest if manifest && Array(manifest["files"]).any?
        end
        break unless listing.dig("pagination", "hasMore")
        page += 1
      end
      collected
    end

    def list_known_repo_skills
      collected = []
      KNOWN_REPOS.each do |repo|
        repo[:slugs].each do |slug|
          manifest = SkillsShClient.get(source: repo[:source], slug: slug) rescue nil
          collected << manifest if manifest && Array(manifest["files"]).any?
        end
      end
      collected
    end
  end
end
