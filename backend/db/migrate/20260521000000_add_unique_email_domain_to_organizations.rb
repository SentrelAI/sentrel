class AddUniqueEmailDomainToOrganizations < ActiveRecord::Migration[8.0]
  # Hard uniqueness on Organization#email_domain — one subdomain per org
  # globally. The previous behavior allowed multiple orgs (even those
  # owned by the same user) to claim the same subdomain, which broke
  # inbound email routing for addresses that didn't have explicit
  # ChannelConfig rows in both orgs.
  #
  # Migration step 1: detect existing duplicates and null them out for
  # all but the FIRST (lowest id) org with each value. The remaining
  # orgs land with email_domain: nil + email_domain_verified: false and
  # will need to re-run onboarding to pick a different subdomain.
  #
  # Migration step 2: add the partial unique index. Case-insensitive.

  def up
    # Step 1 — clean up duplicates by keeping the earliest-created and
    # clearing the rest. Report what we changed.
    dupes_sql = <<~SQL
      SELECT LOWER(email_domain) AS d, ARRAY_AGG(id ORDER BY id) AS ids
      FROM organizations
      WHERE email_domain IS NOT NULL AND email_domain <> ''
      GROUP BY LOWER(email_domain)
      HAVING COUNT(*) > 1
    SQL
    rows = ActiveRecord::Base.connection.execute(dupes_sql).to_a
    if rows.any?
      say "Found #{rows.size} duplicate email_domain group(s); preserving earliest org per group, clearing the rest:"
      rows.each do |row|
        domain = row["d"]
        # ids comes back as a Postgres array literal "{1,2,3}" — parse.
        ids_raw = row["ids"]
        ids = ids_raw.is_a?(Array) ? ids_raw : ids_raw.to_s.tr("{}", "").split(",").map(&:to_i)
        keeper = ids.first
        clearing = ids[1..] || []
        say "  #{domain}: keeping org=#{keeper}, clearing org_ids=#{clearing.inspect}"
        clearing.each do |oid|
          execute "UPDATE organizations SET email_domain = NULL, email_domain_verified = FALSE WHERE id = #{oid.to_i}"
        end
      end
    end

    # Step 2 — partial unique index, case-insensitive. Skipped rows
    # with NULL email_domain so orgs that haven't picked a subdomain yet
    # don't conflict.
    add_index :organizations,
              "LOWER(email_domain)",
              unique: true,
              where: "email_domain IS NOT NULL AND email_domain <> ''",
              name: "index_organizations_on_lower_email_domain_unique"
  end

  def down
    remove_index :organizations, name: "index_organizations_on_lower_email_domain_unique"
  end
end
