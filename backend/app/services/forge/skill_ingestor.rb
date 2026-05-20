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

    # Maps repo-path patterns to our local categories. Falls back to "common".
    CATEGORY_HINTS = {
      /sales|crm|outreach|prospect|hubspot|salesforce/i => "sales",
      /support|ticket|help|zendesk|intercom/i         => "support",
      /content|writing|copy|blog|social|design|video|image/i => "content",
      /engineer|code|dev|github|deploy|aws|docker|kubernetes|vercel/i => "engineering",
      /finance|stripe|invoice|expense|book|account/i  => "finance",
      /calendar|notion|airtable|sheets|drive|document/i => "productivity",
      /slack|email|gmail|chat|messaging/i             => "communication",
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
        visibility: "marketplace",
        published: true,
        skill_md: body,
      )
      record.save!
      sync_files!(record, files)
      maybe_write_seed_file!(record, slug, category, frontmatter, body)

      Result.new(skill: record, source_info: @manifest["source"])
    rescue => e
      Rails.logger.warn "[SkillIngestor] #{@manifest.dig("source")}/#{@manifest.dig("slug")} failed: #{e.message}"
      Result.new(source_info: @manifest["source"], error: e.message)
    end

    private

    # YAML frontmatter parser — same shape as our existing seed loader.
    def parse_frontmatter(raw)
      match = raw.match(/\A---\n(.*?)\n---\s*\n(.*)/m)
      return [{}, raw] unless match
      meta = YAML.safe_load(match[1]) || {}
      [meta, match[2].to_s.lstrip]
    end

    def normalize_slug(s)
      s.to_s.downcase.gsub(/[^a-z0-9-]/, "-").squeeze("-").gsub(/\A-|-\z/, "")
    end

    def infer_category(frontmatter, source, body)
      explicit = frontmatter["category"].to_s.downcase
      return explicit if SkillGenerator::CATEGORIES.include?(explicit)

      haystack = "#{source} #{frontmatter["name"]} #{frontmatter["description"]} #{body[0, 400]}"
      CATEGORY_HINTS.each { |pattern, cat| return cat if haystack.match?(pattern) }
      "common"
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
        "requires_connections" => record.requires_connections,
      }.to_yaml.sub(/\A---\n/, "")
      File.write(path, "---\n#{fm}---\n\n#{body}\n")
    end
  end
end
