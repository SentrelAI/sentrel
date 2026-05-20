namespace :forge do
  desc "Print env-source health table. Exits non-zero if ANTHROPIC_API_KEY missing."
  task check_env: :environment do
    rows = [
      ["ANTHROPIC_API_KEY", ENV["ANTHROPIC_API_KEY"], true,  "required — no key, no generation"],
      ["SKILLS_SH_API_KEY", ENV["SKILLS_SH_API_KEY"], false, "optional — enables skills.sh API (8420 skills)"],
      ["GITHUB_TOKEN",      ENV["GITHUB_TOKEN"],      false, "optional — enables GitHub search source"],
      ["COMPOSIO_API_KEY",  ENV["COMPOSIO_API_KEY"],  false, "optional — for live toolkit catalog refresh"],
    ]
    puts "Forge env-source health:"
    puts "─" * 90
    missing_hard = false
    rows.each do |name, value, required, note|
      mark = value.present? ? "✓" : "✗"
      last4 = value.present? ? " (last 4: ...#{value[-4..]})" : ""
      hardness = required ? "REQUIRED" : "optional"
      missing_hard = true if required && value.blank?
      puts "  #{mark} #{name.ljust(20)} #{hardness.ljust(9)}#{last4}"
      puts "      #{note}"
    end
    puts "─" * 90
    if missing_hard
      puts "✗ Missing required env vars. Set them before running forge:bootstrap."
      exit 1
    else
      puts "✓ Ready to run forge:bootstrap"
    end
  end

  desc "Generate agent templates from a brief list. Args: batch (1|2|all, default 1), concurrency (default 20)"
  task :templates, [:batch, :concurrency] => :environment do |_, args|
    batch = (args[:batch] || "1").to_s
    concurrency = (args[:concurrency] || "20").to_i

    briefs = case batch
             when "1"   then Forge::RoleBriefs::BATCH_1
             when "2"   then Forge::RoleBriefs::BATCH_2
             when "all" then Forge::RoleBriefs::ALL
             else
               raise "Unknown batch: #{batch} (use 1, 2, or all)"
             end

    puts "[forge:templates] firing #{briefs.size} briefs at concurrency=#{concurrency}"
    summary = Forge::Orchestrator.run(briefs: briefs, generator: Forge::TemplateGenerator, concurrency: concurrency)
    puts summary
    puts "[forge:templates] AgentTemplate count: #{AgentTemplate.count}"
  end

  desc "Generate skills from a brief list. Args: batch (1|2|all, default 1), concurrency (default 20)"
  task :skills, [:batch, :concurrency] => :environment do |_, args|
    batch = (args[:batch] || "1").to_s
    concurrency = (args[:concurrency] || "20").to_i

    briefs = case batch
             when "1"   then Forge::SkillBriefs::BATCH_1
             when "2"   then Forge::SkillBriefs::BATCH_2
             when "all" then Forge::SkillBriefs::ALL
             else
               raise "Unknown batch: #{batch} (use 1, 2, or all)"
             end

    puts "[forge:skills] firing #{briefs.size} briefs at concurrency=#{concurrency}"
    summary = Forge::Orchestrator.run(briefs: briefs, generator: Forge::SkillGenerator, concurrency: concurrency)
    puts summary
    puts "[forge:skills] SkillDefinition count: #{SkillDefinition.count}"
  end

  desc "Generate one template from a free-text role description. Args: description"
  task :template_one, [:description] => :environment do |_, args|
    description = args[:description].to_s.strip
    raise "Provide a description, e.g. rake forge:template_one[\"I want a real-estate showing scheduler\"]" if description.empty?
    res = Forge::TemplateGenerator.new(brief: description).call
    if res.ok?
      puts "[forge:template_one] ✓ created #{res.template.slug}"
      puts "  name:     #{res.template.name}"
      puts "  role:     #{res.template.role}"
      puts "  category: #{res.template.category}"
      puts "  model:    #{res.template.suggested_model}"
    else
      puts "[forge:template_one] ✗ #{res.error}"
    end
  end

  desc "Full 100-template bootstrap. Args: concurrency (20), prewarm_count (50), resume (0|1)"
  task :bootstrap, [:concurrency, :prewarm_count, :resume] => :environment do |_, args|
    concurrency = (args[:concurrency] || "20").to_i
    prewarm = (args[:prewarm_count] || "50").to_i
    resume = args[:resume].to_s == "1"
    summary = Forge::Bootstrap.new(concurrency: concurrency, prewarm_count: prewarm, resume: resume).run
    puts summary
  end

  desc "Clear resumable bootstrap state (forget completed briefs)."
  task reset_bootstrap_state: :environment do
    Forge::Bootstrap.reset_state!
    puts "Forge: bootstrap state cleared."
  end

  desc "Scan all published templates for near-duplicates (Jaccard + Levenshtein heuristic)"
  task dedup: :environment do
    groups = Forge::DedupDetector.find_groups(AgentTemplate.where(published: true))
    if groups.empty?
      puts "No near-duplicate groups found (threshold #{Forge::DedupDetector::THRESHOLD})."
    else
      puts "#{groups.size} near-duplicate group(s) above threshold #{Forge::DedupDetector::THRESHOLD}:"
      groups.each_with_index do |group, i|
        puts "\nGroup #{i + 1}:"
        group.each { |t| puts "  - #{t.slug.ljust(28)} (#{t.name})" }
        puts "  Pairwise scores:"
        group.combination(2).each do |a, b|
          m = Forge::DedupDetector.compare(a, b)
          puts "    #{a.slug} ↔ #{b.slug}: score=#{m.score} (identity=#{m.identity_sim} name=#{m.name_sim} skills=#{m.skills_sim})"
        end
      end
    end
  end

  desc "Lint every template + skill against QualityLint rules. Pass --unpublish to downgrade failures."
  task :lint, [:unpublish] => :environment do |_, args|
    unpublish = args[:unpublish].to_s == "1"
    template_pass = template_fail = 0
    skill_pass = skill_fail = 0
    failures = []

    AgentTemplate.where(system_template: true).find_each do |t|
      r = Forge::QualityLint.template(t)
      if r.pass then template_pass += 1
      else
        template_fail += 1
        failures << { type: "template", slug: t.slug, score: r.score, warnings: r.warnings }
        t.update!(published: false) if unpublish && t.published?
      end
    end

    SkillDefinition.find_each do |s|
      r = Forge::QualityLint.skill(s)
      if r.pass then skill_pass += 1
      else
        skill_fail += 1
        failures << { type: "skill", slug: s.slug, score: r.score, warnings: r.warnings }
        s.update!(published: false) if unpublish && s.published?
      end
    end

    puts "Templates: #{template_pass} pass, #{template_fail} fail"
    puts "Skills:    #{skill_pass} pass, #{skill_fail} fail"
    if failures.any?
      puts "\nFailures:"
      failures.each do |f|
        puts "  [#{f[:type]}] #{f[:slug]} (score=#{f[:score]})"
        f[:warnings].each { |w| puts "    - [#{w[:rule]}] #{w[:message]}" }
      end
    end
    puts "\nTip: re-run with [1] to auto-unpublish failures (e.g. rake forge:lint[1])" unless unpublish
  end

  desc "Pre-warm skill library only (skills.sh trending or KNOWN_REPOS)"
  task :prewarm_skills, [:concurrency, :count] => :environment do |_, args|
    concurrency = (args[:concurrency] || "20").to_i
    count = (args[:count] || "50").to_i
    summary = Forge::Bootstrap.new(briefs: [], concurrency: concurrency, prewarm_count: count).run
    puts summary
  end

  desc "Generate one skill from a free-text description. Args: description"
  task :skill_one, [:description] => :environment do |_, args|
    description = args[:description].to_s.strip
    raise "Provide a description, e.g. rake forge:skill_one[\"send fax via documo\"]" if description.empty?
    res = Forge::SkillGenerator.new(brief: description).call
    if res.ok?
      puts "[forge:skill_one] ✓ created #{res.skill.slug}"
      puts "  file: #{res.file_path}"
    else
      puts "[forge:skill_one] ✗ #{res.error}"
    end
  end
end
