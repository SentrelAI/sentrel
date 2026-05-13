# Seed built-in skill definitions from individual files in db/seeds/skills/.
# Each .md file is one skill: YAML frontmatter holds metadata, the body is
# the skill_md the engine ships to the agent. To add a skill, drop a new
# .md file in the appropriate category folder — no central registry to edit.
#
# Run with: bin/rails runner db/seeds/skills.rb
# Idempotent: re-running updates existing rows by slug, never duplicates.

require "yaml"

skills_dir = File.expand_path("skills", __dir__)
created = 0
updated = 0
skipped = 0

Dir.glob(File.join(skills_dir, "**/*.md")).sort.each do |path|
  raw = File.read(path)
  match = raw.match(/\A---\n(.*?)\n---\s*\n(.*)/m)
  unless match
    warn "Skill seed: #{path.sub(skills_dir, '')} missing YAML frontmatter, skipping"
    skipped += 1
    next
  end

  meta = YAML.safe_load(match[1]) || {}
  body = match[2].lstrip

  slug = meta["slug"] || File.basename(path, ".md")
  if slug.blank?
    warn "Skill seed: #{path.sub(skills_dir, '')} has no slug, skipping"
    skipped += 1
    next
  end

  record = SkillDefinition.find_or_initialize_by(slug: slug)
  is_new = record.new_record?
  record.assign_attributes(
    name: meta["name"] || slug.titleize,
    description: meta["description"].to_s,
    category: meta["category"] || "common",
    icon: meta["icon"] || "tool",
    requires_connections: Array(meta["requires_connections"]),
    source: "built_in",
    skill_md: body,
    # Built-in seeds are marketplace-published by default so every org sees
    # them under the System tab. The earlier migration backfilled this for
    # existing rows; new seeds added later (e.g. skill-creator) need it set
    # explicitly here, otherwise they default to private + unpublished and
    # don't show up anywhere.
    visibility: "marketplace",
    published: true,
  )
  record.save!

  # Make sure the SKILL.md content is reflected as a SkillFile row so the
  # multi-file editor + engine sync see it. Update the file in place when
  # the markdown body changed since the last seed run.
  primary = record.skill_files.find_or_initialize_by(path: "SKILL.md")
  primary.assign_attributes(content: body, file_type: "md", position: 0)
  primary.save!

  is_new ? created += 1 : updated += 1
end

puts "Skills seeded: #{created} created, #{updated} updated, #{skipped} skipped (#{SkillDefinition.count} total)"
