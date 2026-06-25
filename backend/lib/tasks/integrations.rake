namespace :integrations do
  desc "Report the integration catalog + per-org connection status from the local DB"
  task check: :environment do
    slugs = IntegrationCatalog.slugs
    puts "✓ IntegrationCatalog loaded (#{slugs.size} services)"

    # 1) Catalog services
    puts ""
    puts "Catalog services:"
    slugs.sort.each { |slug| puts "  - #{slug}" }

    # 2) Per-org connection status
    puts ""
    puts "Active connections per org:"
    Organization.find_each do |org|
      connected = Integration.where(organization_id: org.id, status: "connected")
                             .pluck(:service_name)
                             .compact
                             .uniq
      summary = connected.any? ? "#{connected.size} active: #{connected.sort.join(", ")}" : "0 active"
      puts "  org ##{org.id} (#{org.slug}): #{summary}"
    end
  end
end
