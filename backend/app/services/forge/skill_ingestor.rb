module Forge
  # Takes a skills.sh manifest (or any { slug, source, files: [{path, contents}] }
  # payload) and writes a SkillDefinition + skill_files row tree to our DB.
  # Idempotent on slug — re-running updates content in place.
  #
  # Used by Bootstrap (pre-warm trending skills) and TemplatePack (fill a
  # specific missing skill).
  class SkillIngestor
    Result = Struct.new(:skill, :source_info, :error, keyword_init: true) do
      def ok? = error.nil?
    end

    # Weighted keyword scoring for category inference. Signals carry
    # different weights:
    #   - frontmatter `category` (explicit author intent) → 10
    #   - repo / source-path tokens (organizational signal)  → 5
    #   - skill body text (most authoritative content signal) → 3
    #   - skill name (short, often-generic)                   → 2
    # Highest-scoring category wins; ties break alphabetically. Falls back
    # to "common" if every score is zero.
    CATEGORY_KEYWORDS = {
      "sales"          => %w[sales crm outreach prospect hubspot salesforce pipedrive apollo lead deal pipeline],
      "support"        => %w[support ticket help zendesk intercom escalation customer-service],
      "content"        => %w[content writing copy blog post design video image creative caption brand],
      "engineering"    => %w[engineer code dev github deploy aws docker kubernetes vercel api ci cd pipeline],
      "finance"        => %w[finance stripe invoice expense bookkeep account payment refund payable receivable],
      "productivity"   => %w[calendar notion airtable sheets drive document task schedule meeting reminder],
      "communication"  => %w[slack email gmail chat message sms whatsapp telegram]
    }.freeze

    def initialize(manifest:, write_seed_file: false)
      @manifest = manifest.is_a?(Hash) ? manifest.deep_stringify_keys : manifest
      @write_seed_file = write_seed_file
    end

    def call
      files = Array(@manifest["files"])
      skill_md_file = files.find { |f| f["path"].to_s.casecmp("SKILL.md").zero? }
      raise "manifest has no SKILL.md" unless skill_md_file

      frontmatter, body = parse_frontmatter(skill_md_file["contents"].to_s)
      slug = (@manifest["slug"].presence || frontmatter["name"].presence || frontmatter["slug"].presence).to_s
      slug = normalize_slug(slug)
      raise "could not derive slug" if slug.empty?

      category = infer_category(frontmatter, @manifest["source"], body)
      name = frontmatter["name"].presence || slug.titleize
      description = frontmatter["description"].presence || "Imported from #{@manifest["source"]}"
      icon = frontmatter["icon"].presence || "tool"

      record = SkillDefinition.find_or_initialize_by(slug: slug)
      record.assign_attributes(
        name: name,
        description: description.to_s.truncate(255),
        category: category,
        icon: icon.to_s.downcase,
        requires_connections: Array(frontmatter["requires_connections"]).map(&:to_s),
        required_capabilities: Array(frontmatter["required_capabilities"]).map(&:to_s),
        source: "imported",
        source_url: derive_source_url(skill_md_file["path"]),
        visibility: "marketplace",
        published: true,
        skill_md: body,
      )
      record.save!
      sync_files!(record, files)
      maybe_write_seed_file!(record, slug, category, frontmatter, body)

      # Quality gate. A skill that fails (missing sections, buzzwords,
      # too short) gets unpublished so the admin can review before it
      # surfaces in the marketplace.
      lint = QualityLint.skill(record)
      unless lint.pass
        record.update!(published: false)
        Rails.logger.warn "[Forge::SkillIngestor] #{record.slug} failed lint (score=#{lint.score}): " +
                          lint.warnings.map { |w| "[#{w[:rule]}] #{w[:message]}" }.join(" | ")
      end

      Result.new(skill: record, source_info: @manifest["source"])
    rescue => e
      Rails.logger.warn "[SkillIngestor] #{@manifest.dig("source")}/#{@manifest.dig("slug")} failed: #{e.message}"
      Result.new(source_info: @manifest["source"], error: e.message)
    end

    private

    # YAML frontmatter parser — same shape as our existing seed loader.
    def parse_frontmatter(raw)
      match = raw.match(/\A---\n(.*?)\n---\s*\n(.*)/m)
      return [ {}, raw ] unless match
      # Some third-party SKILL.md frontmatter includes Date / Time / Symbol
      # values (created_on, updated_at, etc). Whitelist them so safe_load
      # doesn't raise "Tried to load unspecified class: Date" mid-bootstrap.
      meta = YAML.safe_load(match[1], permitted_classes: [ Date, Time, Symbol ], aliases: true) || {}
      [ meta, match[2].to_s.lstrip ]
    end

    def normalize_slug(s)
      s.to_s.downcase.gsub(/[^a-z0-9-]/, "-").squeeze("-").gsub(/\A-|-\z/, "")
    end

    # Weighted multi-signal scoring. Beats the old single-regex sweep
    # because it doesn't let stray words ("engineer" in "social media
    # engineering") capture a skill that's clearly content/marketing.
    def infer_category(frontmatter, source, body)
      explicit = frontmatter["category"].to_s.downcase
      return explicit if SkillGenerator::CATEGORIES.include?(explicit)

      scores = Hash.new(0)

      # Signal 1: source / repo path keywords (weight 5 per hit)
      tokens_in(source.to_s).each do |tok|
        CATEGORY_KEYWORDS.each { |cat, kws| scores[cat] += 5 if kws.include?(tok) }
      end

      # Signal 2: body text first 800 chars (weight 3 per hit, capped to
      # avoid one common word dominating)
      body_tokens = tokens_in(body.to_s[0, 800])
      seen_in_body = Set.new
      body_tokens.each do |tok|
        next if seen_in_body.include?(tok)
        CATEGORY_KEYWORDS.each do |cat, kws|
          if kws.include?(tok)
            scores[cat] += 3
            seen_in_body << tok
          end
        end
      end

      # Signal 3: name (weight 2 per hit)
      tokens_in("#{frontmatter["name"]} #{frontmatter["slug"]}").each do |tok|
        CATEGORY_KEYWORDS.each { |cat, kws| scores[cat] += 2 if kws.include?(tok) }
      end

      return "common" if scores.empty?
      scores.sort_by { |cat, sc| [ -sc, cat ] }.first.first
    end

    def tokens_in(text)
      text.to_s.downcase.scan(/[a-z][a-z0-9]{2,}/)
    end

    # Best-effort source-of-truth URL the admin can click through to. For
    # skills.sh manifests `source` is "owner/repo"; for GitHub-scraped
    # manifests we already have a path. For SkillGenerator output we have
    # no upstream URL, so leave it nil.
    def derive_source_url(skill_md_path)
      source = @manifest["source"].to_s
      return nil if source.blank? || source == "generated"
      # owner/repo coordinate → link to the repo's SKILL.md.
      if source.match?(%r{\A[^/\s]+/[^/\s]+\z})
        return "https://github.com/#{source}/blob/main/#{skill_md_path}"
      end
      # Already a URL.
      source if source.start_with?("http")
    end

    def sync_files!(record, files)
      seen = []
      files.each_with_index do |f, idx|
        path = f["path"].to_s
        next if path.empty?
        seen << path
        primary = record.skill_files.find_or_initialize_by(path: path)
        ext = File.extname(path).delete(".").presence || "md"
        primary.assign_attributes(content: f["contents"].to_s, file_type: ext, position: idx)
        primary.save!
      end
      # Tidy up: drop any old file paths that this manifest no longer has.
      record.skill_files.where.not(path: seen).destroy_all if seen.any?
    end

    def maybe_write_seed_file!(record, slug, category, frontmatter, body)
      return unless @write_seed_file
      dir = Rails.root.join("db/seeds/skills", category)
      FileUtils.mkdir_p(dir)
      path = dir.join("#{slug}.md")
      fm = {
        "slug" => slug,
        "name" => record.name,
        "description" => record.description,
        "category" => category,
        "icon" => record.icon,
        "requires_connections" => record.requires_connections
      }.to_yaml.sub(/\A---\n/, "")
      File.write(path, "---\n#{fm}---\n\n#{body}\n")
    end
  end
end
