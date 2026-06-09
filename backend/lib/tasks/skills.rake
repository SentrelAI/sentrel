namespace :skills do
  desc "Demote non-canonical built_in SkillDefinitions → source=imported. Canonical = the skill files in db/seeds/skills/**/*.md. Forge-generated rows that snuck into source=built_in get demoted (still installable; just stops them from polluting the new-agent drafter's catalog query)."
  task demote_non_canonical_seeds: :environment do
    seed_dir = Rails.root.join("db/seeds/skills")
    unless seed_dir.directory?
      puts "Missing #{seed_dir}; can't determine canonical list. Aborting."
      next
    end
    canonical = Dir.glob(seed_dir.join("**/*.md")).map { |p| File.basename(p, ".md") }.uniq
    if canonical.empty?
      puts "Seed dir parsed 0 canonical slugs — aborting (would demote everything)."
      next
    end
    puts "Canonical platform skills (#{canonical.length}): #{canonical.sort.join(', ')}"

    offenders = SkillDefinition.where(source: "built_in").where.not(slug: canonical)
    n = offenders.count
    if n.zero?
      puts "Nothing to demote — every source=built_in row is in the canonical list."
      next
    end

    puts "\nDemoting #{n} non-canonical built_in skills → source=imported:"
    offenders.find_each do |s|
      print "  - #{s.slug.ljust(45)} (#{s.category})"
      s.update_column(:source, "imported")
      puts " ✓"
    end
    puts "\nDone. The drafter's catalog query (source=built_in OR organization_id=org) now only surfaces the curated #{canonical.length}."
  end

  desc "Show catalog health — counts by source, plus a sample of suspicious slugs"
  task catalog_health: :environment do
    total       = SkillDefinition.count
    by_source   = SkillDefinition.group(:source).count
    published   = SkillDefinition.where(published: true).count
    puts "SkillDefinition total: #{total}  published: #{published}"
    puts "By source:"
    by_source.sort_by { |_, v| -v }.each { |src, c| puts "  #{src.to_s.ljust(15)} #{c}" }

    seed_dir = Rails.root.join("db/seeds/skills")
    canonical = Dir.glob(seed_dir.join("**/*.md")).map { |p| File.basename(p, ".md") }
    weird = SkillDefinition.where(source: "built_in").where.not(slug: canonical).limit(20).pluck(:slug)
    if weird.any?
      puts "\nSample of source=built_in skills NOT in the canonical seed folder (#{weird.length} shown):"
      weird.each { |s| puts "  - #{s}" }
      puts "Run `bin/rails skills:demote_non_canonical_seeds` to demote them."
    else
      puts "\nNo non-canonical built_in skills found. Catalog is clean."
    end
  end
end
