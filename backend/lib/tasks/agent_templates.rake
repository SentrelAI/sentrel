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
            "source"      => "backfill_from_legacy_template_row",
          },
          "persona" => {
            "identity_md"        => t.identity_md,
            "personality_md"     => t.personality_md,
            "instructions_md"    => t.instructions_md,
            "email_signature_md" => t.email_signature_md,
          },
          "model" => {
            "provider"  => t.suggested_provider,
            "model_id"  => t.suggested_model,
          }.compact,
          "capabilities" => t.capabilities.presence || {},
          # Legacy templates only stored slug arrays + integration service
          # names — no embedded skill bundles, no approval rules. v1 captures
          # that faithfully; re-publishing later embeds the full bundles.
          "skills"                 => Array(t.suggested_skill_slugs).map { |s| { "slug" => s } },
          "integrations_required"  => Array(t.suggested_integrations).map { |s| { "service" => s } },
          "credentials_required"   => [],
          "channels_required"      => [],
          "approval_rules"         => [],
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
end
