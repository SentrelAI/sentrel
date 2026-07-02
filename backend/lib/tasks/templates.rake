# Import agent-bundle/v1 directories as SYSTEM templates onto /templates.
# Bundles are the source of truth; this is how they land in the app.
#
#   rails templates:import_bundles[/path/to/sentrel-agent-templates]
#   rails templates:import_bundles[/path/to/repo,SentrelAI/agent-templates,main]
#
# Each immediate sub-directory that contains an agent.yaml is imported. The
# source_url is derived as https://github.com/<repo>/tree/<ref>/<dir>. Idempotent.
namespace :templates do
  desc "Import agent bundles from a checkout dir as system templates"
  task :import_bundles, %i[dir repo ref] => :environment do |_t, args|
    dir  = args[:dir].presence || ENV["BUNDLES_DIR"]
    repo = args[:repo].presence || ENV.fetch("BUNDLES_REPO", "SentrelAI/agent-templates")
    ref  = args[:ref].presence  || ENV.fetch("BUNDLES_REF", "main")
    abort "usage: rails templates:import_bundles[/path/to/bundles-checkout]" if dir.blank?
    abort "not a directory: #{dir}" unless File.directory?(dir)

    bundles = Dir.children(dir)
                 .map { |name| File.join(dir, name) }
                 .select { |p| File.directory?(p) && File.file?(File.join(p, "agent.yaml")) }
                 .sort

    abort "no bundles (dirs with agent.yaml) found under #{dir}" if bundles.empty?
    puts "[templates:import_bundles] #{bundles.size} bundle(s) from #{repo}@#{ref}"

    ok = 0
    bundles.each do |bundle_dir|
      name = File.basename(bundle_dir)
      source_url = "https://github.com/#{repo}/tree/#{ref}/#{name}"
      begin
        t = AgentTemplates::BundleImporter.new(dir: bundle_dir, source_url: source_url, source_ref: ref).call
        puts "  ✓ #{t.slug.ljust(20)} v#{t.current_version&.version_number}  ← #{name}"
        ok += 1
      rescue => e
        warn "  ✗ #{name}: #{e.class}: #{e.message}"
      end
    end
    puts "[templates:import_bundles] imported #{ok}/#{bundles.size}"
  end

  # Repo-driven sync: fetch the PUBLIC agent-templates repo tarball and import
  # every bundle. Run on a schedule (sidekiq-cron) or trigger from a GitHub
  # Action on push to the templates repo (repository_dispatch → this task).
  #
  #   rails templates:sync
  #   BUNDLES_REPO=SentrelAI/agent-templates BUNDLES_REF=main rails templates:sync
  desc "Sync system templates from the public agent-templates GitHub repo"
  task sync: :environment do
    require "open-uri"
    require "tmpdir"
    repo = ENV.fetch("BUNDLES_REPO", "SentrelAI/agent-templates")
    ref  = ENV.fetch("BUNDLES_REF", "main")
    url  = "https://codeload.github.com/#{repo}/tar.gz/refs/heads/#{ref}"
    puts "[templates:sync] fetching #{url}"

    Dir.mktmpdir do |tmp|
      tarball = File.join(tmp, "bundles.tar.gz")
      URI.parse(url).open { |io| File.binwrite(tarball, io.read) }
      abort "[templates:sync] extract failed" unless system("tar", "xzf", tarball, "-C", tmp)
      # GitHub tarballs extract to <repo>-<ref>/…
      root = Dir.children(tmp)
                .map { |c| File.join(tmp, c) }
                .find { |p| File.directory?(p) && File.basename(p).start_with?(File.basename(repo)) }
      abort "[templates:sync] extracted repo dir not found" unless root
      Rake::Task["templates:import_bundles"].invoke(root, repo, ref)
    end
  end

  # Export a single AgentTemplate → an agent-bundle/v1 directory (agent.yaml +
  # persona md + any custom skills). The inverse of BundleImporter; the tool
  # that migrates the Ruby seed catalog into forkable bundles (point 5).
  #
  #   rails templates:export_bundle[ceo,tmp/bundles]
  desc "Export one AgentTemplate (by slug) as an agent-bundle/v1 dir"
  task :export_bundle, %i[slug outdir] => :environment do |_t, args|
    slug   = args[:slug].to_s.strip
    outdir = args[:outdir].presence || "tmp/bundles"
    abort "usage: rails templates:export_bundle[slug,outdir]" if slug.empty?
    t = ActsAsTenant.without_tenant { AgentTemplate.find_by(slug: slug) }
    abort "no template with slug #{slug.inspect}" unless t
    dir = AgentTemplates::BundleExporter.new(t).write_to(outdir)
    puts "  ✓ #{slug} → #{dir}"
  end

  # Bulk driver for point 5: export every slug still defined in the Ruby seed
  # file into bundles under outdir, so they can be committed to the
  # agent-templates repo and re-imported. Reads the canonical slug list from
  # the seed file itself (no drift). Idempotent — overwrites outdir/<slug>.
  #
  #   rails templates:export_seeds[tmp/bundles]
  desc "Export all seed-file templates as bundles (point 5 migration driver)"
  task :export_seeds, %i[outdir] => :environment do |_t, args|
    outdir    = args[:outdir].presence || "tmp/bundles"
    seed_file = Rails.root.join("db/seeds/agent_templates.rb")
    abort "seed file missing: #{seed_file}" unless seed_file.exist?
    slugs = seed_file.read.scan(/slug:\s*"([^"]+)"/).flatten.uniq
    abort "parsed 0 slugs from seed file" if slugs.empty?
    puts "[templates:export_seeds] exporting #{slugs.size} seed template(s) → #{outdir}"

    ActsAsTenant.without_tenant do
      ok = 0
      slugs.each do |slug|
        t = AgentTemplate.find_by(slug: slug)
        unless t
          warn "  ✗ #{slug}: not in DB (run db:seed first)"
          next
        end
        dir = AgentTemplates::BundleExporter.new(t).write_to(outdir)
        puts "  ✓ #{slug.ljust(20)} → #{dir}"
        ok += 1
      end
      puts "[templates:export_seeds] exported #{ok}/#{slugs.size}"
    end
  end

  # Cull the public catalog down to GitHub-backed templates only. UNPUBLISHES
  # (does not delete) every template without a source_url, so /templates shows
  # just the verified bundle library. Reversible — rows are kept, only
  # published:false. Run after the AgentTemplate.catalog guard ships.
  #
  #   rails templates:cull_non_github           # dry-run: show what would change
  #   rails templates:cull_non_github[go]       # actually unpublish
  desc "Unpublish all non-GitHub (source_url IS NULL) templates — reversible"
  task :cull_non_github, %i[confirm] => :environment do |_t, args|
    go = args[:confirm].to_s == "go"
    ActsAsTenant.without_tenant do
      targets = AgentTemplate.where(source_url: nil, published: true)
      n = targets.count
      puts "[cull] #{n} non-GitHub published template(s) would be unpublished."
      puts "[cull] GitHub-backed catalog to keep: #{AgentTemplate.catalog.count}"
      unless go
        puts "[cull] DRY RUN — re-run as templates:cull_non_github[go] to apply."
        next
      end
      targets.update_all(published: false, updated_at: Time.current)
      puts "[cull] done. Public catalog now shows #{AgentTemplate.catalog.count} GitHub-backed templates."
      puts "[cull] reverse with: AgentTemplate.unscoped.where(source_url: nil).update_all(published: true)"
    end
  end

  # Hard-delete the Forge-generated junk (source_url IS NULL, created_by_user_id
  # IS NULL, system_template = false) — the auto-generated bootstrap templates,
  # NOT the hand-seeded 16 (those migrate to bundles) and NOT anything a human
  # created. Deployed agents are unaffected (they copy the definition at deploy).
  #
  #   rails templates:delete_forge_junk          # dry-run
  #   rails templates:delete_forge_junk[go]      # delete
  desc "Delete Forge-generated templates (no source, no human author, non-system)"
  task :delete_forge_junk, %i[confirm] => :environment do |_t, args|
    go = args[:confirm].to_s == "go"
    ActsAsTenant.without_tenant do
      targets = AgentTemplate.where(source_url: nil, created_by_user_id: nil, system_template: false)
      n = targets.count
      puts "[delete_forge] #{n} Forge-generated template(s) match (no source, no author, non-system)."
      unless go
        puts "[delete_forge] sample: #{targets.limit(10).pluck(:slug).join(', ')}"
        puts "[delete_forge] DRY RUN — re-run as templates:delete_forge_junk[go] to delete."
        next
      end
      deleted = targets.destroy_all.size
      puts "[delete_forge] deleted #{deleted}. Remaining templates: #{AgentTemplate.unscoped.count}."
    end
  end
end
