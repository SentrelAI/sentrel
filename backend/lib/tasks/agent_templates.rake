# Backfill rake tasks for AgentTemplate / AgentTemplateVersion.
#
# `rails agent_templates:backfill_versions` — for every AgentTemplate that
# doesn't yet have a current_version_id, build a v1 from the existing
# flat columns (identity_md, capabilities, suggested_skill_slugs, etc.)
# via the new Exporter shape and link it. Idempotent — safe to re-run.
#
# Runs automatically after the v1 schema migration on first deploy; included
# here as a manual escape hatch for production rollouts where you'd rather
# kick the backfill explicitly than have a migration do it.

namespace :agent_templates do
  desc "Backfill v1 AgentTemplateVersion rows for legacy templates"
  task backfill_versions: :environment do
    require "ostruct"

    ActsAsTenant.without_tenant do
      total = AgentTemplate.count
      missing = AgentTemplate.where(current_version_id: nil).count
      puts "AgentTemplates: total=#{total} missing_current_version=#{missing}"

      AgentTemplate.where(current_version_id: nil).find_each do |t|
        # Build a minimal v1 definition from the flat columns. This mirrors
        # what AgentTemplates::Exporter would emit if it were running against
        # an Agent — but here the source is the template row itself, so we
        # skip skill bundle inlining (the legacy rows only stored slugs).
        definition = {
          "spec_version" => "1.0",
          "kind"         => "agent",
          "name"         => t.name,
          "role"         => t.role,
          "description"  => t.description,
          "category"     => t.category,
          "icon"         => t.icon,
          "license"      => t.license.presence || "CC-BY-4.0",
          "metadata"     => {
            "exported_at" => t.updated_at&.iso8601,
            "source"      => "backfill_from_legacy_template_row"
          },
          "persona" => {
            "identity_md"        => t.identity_md,
            "personality_md"     => t.personality_md,
            "instructions_md"    => t.instructions_md,
            "email_signature_md" => t.email_signature_md
          },
          "model" => {
            "provider"  => t.suggested_provider,
            "model_id"  => t.suggested_model
          }.compact,
          "capabilities" => t.capabilities.presence || {},
          # Legacy templates only stored slug arrays + integration service
          # names — no embedded skill bundles, no approval rules. v1 captures
          # that faithfully; re-publishing later embeds the full bundles.
          "skills"                 => Array(t.suggested_skill_slugs).map { |s| { "slug" => s } },
          "integrations_required"  => Array(t.suggested_integrations).map { |s| { "service" => s } },
          "credentials_required"   => [],
          "channels_required"      => [],
          "approval_rules"         => []
        }

        version = AgentTemplateVersion.create!(
          agent_template: t,
          version_number: 1,
          spec_version:   "1.0",
          definition:     definition,
          license:        t.license.presence || "CC-BY-4.0",
          changelog:      "Backfilled from legacy template row.",
          created_by_user_id: t.created_by_user_id,
          published:      true,
        )
        t.update_column(:current_version_id, version.id)
        print "."
      end
      puts "\nDone. Re-run safely; only templates with current_version_id IS NULL are touched."
    end
  end

  desc "Scrub stale/hallucinated skill slugs + bloated integration lists from existing templates"
  task scrub_bad_data: :environment do
    ActsAsTenant.without_tenant do
      known_skill_slugs = SkillDefinition.pluck(:slug).to_set
      puts "Known skill catalog: #{known_skill_slugs.size} slugs"

      scrubbed = 0
      AgentTemplate.find_each do |t|
        old_skills = Array(t.suggested_skill_slugs)
        old_ints   = Array(t.suggested_integrations)
        new_skills = old_skills.select { |s| known_skill_slugs.include?(s) }
        new_ints   = Forge::TemplateGenerator.sanitize_integrations(old_ints)

        next if new_skills == old_skills && new_ints == old_ints

        dropped_skills = old_skills - new_skills
        dropped_ints   = old_ints - new_ints

        t.update_columns(
          suggested_skill_slugs: new_skills,
          suggested_integrations: new_ints,
        )
        scrubbed += 1
        puts "  #{t.slug}"
        puts "    skills:       #{old_skills.length} → #{new_skills.length}#{dropped_skills.any? ? "  (dropped: #{dropped_skills.join(', ')})" : ''}"
        puts "    integrations: #{old_ints.length} → #{new_ints.length}#{dropped_ints.any? ? "  (dropped: #{dropped_ints.join(', ')})" : ''}"
      end

      puts scrubbed.zero? ? "\nClean — no templates needed scrubbing." : "\nScrubbed #{scrubbed} template(s)."
    end
  end

  desc "Delete a non-system template by slug (e.g. bdr). Safe — system seeds are refused."
  task :delete, [ :slug ] => :environment do |_, args|
    slug = args[:slug].to_s.strip
    if slug.empty?
      puts "Usage: bin/rails agent_templates:delete[the-slug]"
      next
    end
    ActsAsTenant.without_tenant do
      t = AgentTemplate.find_by(slug: slug)
      unless t
        puts "No template with slug #{slug.inspect}"
        next
      end
      if t.system_template
        puts "Refusing to delete system seed #{slug.inspect}. If you really need to, edit the row by hand."
        next
      end
      puts "Deleting #{t.slug}  name=#{t.name}  org=#{t.organization_id}  versions=#{t.versions.count}"
      t.destroy
      puts "Deleted."
    end
  end

  desc "Demote non-canonical system templates → community. Canonical = the slugs hand-seeded in db/seeds/agent_templates.rb PLUS any bundle-imported template (source_url present). Forge-generated templates that snuck system_template=true get demoted (still visible as community templates so users who already installed them aren't broken)."
  task demote_non_canonical_seeds: :environment do
    seed_file = Rails.root.join("db/seeds/agent_templates.rb")
    unless seed_file.exist?
      puts "Missing #{seed_file}; can't determine canonical list. Aborting."
      next
    end
    seeded = seed_file.read.scan(/slug:\s*"([^"]+)"/).flatten.uniq
    if seeded.empty?
      puts "Seed file parsed 0 canonical slugs — aborting (would demote everything)."
      next
    end

    ActsAsTenant.without_tenant do
      # Bundle-imported templates (from SentrelAI/agent-templates) are canonical
      # too — they carry a source_url. Without this, retiring a seed entry in
      # favour of its bundle would make this task demote the bundle version.
      imported = AgentTemplate.where.not(source_url: nil).pluck(:slug).uniq
      canonical = (seeded + imported).uniq
      puts "Canonical system templates (#{canonical.length} = #{seeded.length} seeded + #{imported.length} bundle-imported): #{canonical.join(', ')}"

      offenders = AgentTemplate.where(system_template: true).where.not(slug: canonical)
      n = offenders.count
      if n.zero?
        puts "Nothing to demote — every system_template row is in the canonical list."
        next
      end
      puts "\nDemoting #{n} non-canonical system templates → community (system_template=false, published stays as-is):"
      offenders.find_each do |t|
        puts "  - #{t.slug}  (#{t.role})"
        t.update_column(:system_template, false)
      end
      puts "\nDone. The drafter's [SYS] preference now only elevates the curated system templates (seeds + bundle-imported)."
    end
  end

  desc "List Forge-generated SkillDefinitions that look like hallucinations (no SkillFile rows, source 'generated')"
  task list_suspicious_skills: :environment do
    suspicious = SkillDefinition
      .where(source: [ "generated", "ai_generated", "forge" ])
      .left_joins(:skill_files)
      .group("skill_definitions.id")
      .having("COUNT(skill_files.id) = 0")
      .pluck(:slug, :name, :source, :created_at)
    if suspicious.empty?
      puts "No suspicious skills (every generated skill has at least one SkillFile)."
    else
      puts "Suspicious skills (#{suspicious.length}) — generated but have no SkillFile rows:"
      suspicious.each { |slug, name, src, t| puts "  #{slug.ljust(40)}  #{src.ljust(12)}  created=#{t}  name=#{name}" }
      puts "\nDelete with: SkillDefinition.where(slug: 'the-slug').destroy_all  in a Rails console."
    end
  end
end
