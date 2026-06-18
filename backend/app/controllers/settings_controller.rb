class SettingsController < ApplicationController
  before_action :authenticate_user!

  # GET /settings/subdomain_availability?label=acme[&zone=sentrel.ai]
  # Live availability check for the subdomain picker. Returns whether
  # `<label>.<zone>` is reserved (already used by another org or our own
  # email channel configs). Cheap query — debounced from the UI.
  def subdomain_availability
    label = sanitize_subdomain_label(params[:label])
    zone  = params[:zone].presence || Email::DnsAutoConfigurator.available_zones.first&.dig(:zone)
    if label.blank? || zone.blank?
      return render json: { available: false, reason: "Enter a subdomain (letters, numbers, hyphens)" }
    end
    full = "#{label}.#{zone}"

    if Organization.where("LOWER(email_domain) = ?", full).where.not(id: current_tenant.id).exists?
      return render json: { available: false, full: full, reason: "already taken by another workspace" }
    end
    if ChannelConfig.where(channel_type: "email").where("LOWER(config->>'address') LIKE ?", "%@#{full}").exists?
      return render json: { available: false, full: full, reason: "already in use" }
    end

    render json: { available: true, full: full }
  end

  # GET /settings/email_change_impact
  # Returns the list of agents whose email channel addresses are on the org's
  # current email_domain — used to preview a domain change before committing.
  def email_change_impact
    agents = Email::DomainMigration.impact_for(current_tenant, domain: current_tenant.email_domain)
    render json: { current_domain: current_tenant.email_domain, agents: agents }
  end

  # POST /settings/reset_email_domain
  # Clears the org's email_domain so the picker shows again. Accepts a `mode`
  # param that drives what happens to existing email channels:
  #   migrate     — default; remember the old domain so the next domain set
  #                 auto-renames addresses (sarah@old → sarah@new).
  #   disconnect  — immediately drop every email ChannelConfig; user re-adds
  #                 them after picking the new domain.
  # We don't touch SES identity / Route 53 records — those are idempotent on
  # re-pick; re-claiming the same name lands on a fully-verified state.
  def reset_email_domain
    mode = params[:mode].to_s.presence_in(%w[migrate disconnect]) || "migrate"
    previous_domain = current_tenant.email_domain

    if mode == "disconnect" && previous_domain.present?
      Email::DomainMigration.disconnect!(current_tenant)
      session[:pending_email_migration_from] = nil
    elsif mode == "migrate" && previous_domain.present?
      session[:pending_email_migration_from] = previous_domain
    end

    current_tenant.update!(email_domain: nil, email_domain_verified: false)
    msg = mode == "disconnect" ?
      "Email domain cleared and agent inboxes disconnected — pick a new domain to start fresh." :
      "Email domain cleared — agents will move to the new domain automatically once you pick one."
    redirect_to settings_path, notice: msg
  end

  # POST /settings/claim_managed_subdomain
  # One-click "give me <label>.<zone>" — sets organization.email_domain to
  # the picked subdomain, then redirects to settings with ?connect=1 so the
  # page auto-runs Connect on mount. Accepts either a `label` (just the
  # subdomain part — preferred path from the picker UI) or a full `domain`
  # (legacy / "claim suggested" button).
  def claim_managed_subdomain
    zone = params[:zone].presence || Email::DnsAutoConfigurator.available_zones.first&.dig(:zone)
    if (label = params[:label].to_s.strip).present? && zone
      sanitized = sanitize_subdomain_label(label)
      return render json: { error: "Invalid subdomain — letters, numbers, hyphens only" }, status: :unprocessable_entity if sanitized.blank?
      requested = "#{sanitized}.#{zone}"
    else
      suggested = Email::DnsAutoConfigurator.suggested_subdomain_for(current_tenant.slug)
      requested = params[:domain].to_s.strip.presence || suggested
    end

    return render json: { error: "No managed zone configured" }, status: :unprocessable_entity unless requested
    unless Email::DnsAutoConfigurator.managed?(requested)
      return render json: { error: "#{requested} is not under any managed zone" }, status: :unprocessable_entity
    end

    if Organization.where("LOWER(email_domain) = ?", requested).where.not(id: current_tenant.id).exists?
      return render json: { error: "#{requested} is already taken" }, status: :conflict
    end
    if ChannelConfig.where(channel_type: "email").where("LOWER(config->>'address') LIKE ?", "%@#{requested}").exists?
      return render json: { error: "#{requested} is already in use" }, status: :conflict
    end

    current_tenant.update!(email_domain: requested, email_domain_verified: false)
    migrated = run_pending_email_migration!(requested)
    notice = "Claimed #{requested}; we'll auto-configure DNS now."
    notice += " Moved #{migrated} agent #{'inbox'.pluralize(migrated)} to the new domain." if migrated.positive?
    redirect_to settings_path(connect: 1), notice: notice
  end

  # GET /settings/ses_status?region=us-east-1
  # Queries SES for the current account's send quota in the requested region.
  # max_24_hour_send = 200 is the sandbox cap; anything above means
  # production access was approved. Polled by the UI on the BYO card so
  # users see if their region is gated before they spin up a domain.
  def ses_status
    region = params[:region].presence ||
             current_tenant.email_aws_region.presence ||
             ENV.fetch("AWS_REGION", "us-east-1")
    client = Aws::SES::Client.new(region: region)
    quota = client.get_send_quota
    render json: {
      region: region,
      max_24_hour_send: quota.max_24_hour_send,
      max_send_rate: quota.max_send_rate,
      sent_last_24h: quota.sent_last_24_hours,
      sandbox: quota.max_24_hour_send.to_i <= 200,
      inbound_supported: %w[us-east-1 us-west-2 eu-west-1].include?(region)
    }
  rescue Aws::SES::Errors::ServiceError => e
    render json: { region: region, error: e.message, code: e.class.name.demodulize }, status: :unprocessable_entity
  end

  def show
    # Subscription auth (Anthropic Pro/Max paste-token) lives here, not on
    # /integrations — different mental model. /integrations is "what services
    # can my agents act on?", /settings is "how is my workspace configured?".
    anthropic_cred = begin
      if defined?(OauthCredential) && ActiveRecord::Base.connection.table_exists?("oauth_credentials")
        OauthCredential.find_by(organization_id: current_tenant.id, provider: "anthropic", kind: "ai_provider")
      end
    rescue StandardError
      nil
    end

    # Front-desk Slack agent picker — only show when at least one agent in
    # the org has Slack connected. Empty list = no Slack installed yet, so
    # we don't need to render the dropdown at all.
    slack_agents = current_tenant.agents.joins(:channel_configs)
      .where(channel_configs: { channel_type: "slack", enabled: true })
      .distinct.order(:name)
      .as_json(only: [ :id, :name, :role ])

    render inertia: "settings/show", props: {
      organization: current_tenant.as_json(only: [
        :id, :name, :slug, :email_domain, :email_domain_verified, :context_md,
        :default_slack_agent_id
      ]),
      # All members of this org (membership-based), with their role in THIS org.
      members: current_tenant.memberships.includes(:user).map { |m|
        m.user.as_json(only: [ :id, :name, :email, :created_at ]).merge("role" => m.role)
      }.sort_by { |u| u["name"].to_s },
      anthropic_account: {
        provider: "anthropic",
        connected: anthropic_cred.present?,
        account_email: anthropic_cred&.account_email,
        expires_at: anthropic_cred&.expires_at,
        last_refreshed_at: anthropic_cred&.last_refreshed_at
      },
      managed_dns: {
        zones: Email::DnsAutoConfigurator.available_zones,
        suggested_subdomain: Email::DnsAutoConfigurator.suggested_subdomain_for(current_tenant.slug),
        auto_connect: params[:connect] == "1"
      },
      slack_agents: slack_agents
    }
  end

  def update
    if current_tenant.update(organization_params)
      migrated = run_pending_email_migration!(current_tenant.email_domain)
      notice = "Settings updated"
      notice += " — moved #{migrated} agent #{'inbox'.pluralize(migrated)} to the new domain." if migrated.positive?
      redirect_to settings_path, notice: notice
    else
      redirect_back fallback_location: settings_path, alert: current_tenant.errors.full_messages.join(", ")
    end
  end

  # POST /settings/verify_domain
  # Smart "connect domain" — idempotently:
  #   1. Creates the SES identity (returns verification + DKIM tokens)
  #   2. Builds the 6 DNS records the user needs
  #   3. If the domain falls under a zone we manage on Cloudflare, applies
  #      those records automatically so the user doesn't have to copy/paste
  #   4. Reads back the current verification status
  # Returns a structured payload the UI can render with proper feedback per
  # phase (identity-created / dns-applied / pending / verified / error).
  def verify_domain
    domain = current_tenant.email_domain
    return render json: { error: "No domain set" }, status: :unprocessable_entity unless domain.present?

    ses = SesClient.for(current_tenant)
    result = ses.verify_domain_identity(domain: domain)
    dkim = ses.verify_domain_dkim(domain: domain)
    records = build_dns_records(domain, result.verification_token, dkim.dkim_tokens)

    auto_dns = nil
    if Email::DnsAutoConfigurator.managed?(domain)
      begin
        auto_dns = Email::DnsAutoConfigurator.apply!(domain, records)
      rescue StandardError => e
        Rails.logger.warn "DNS auto-config failed for #{domain}: #{e.class}: #{e.message}"
        auto_dns = { error: e.message }
      end
    end

    # Read live verification + DKIM status so the UI shows the right state.
    status = ses.get_identity_verification_attributes(identities: [ domain ]).verification_attributes[domain]
    if status&.verification_status == "Success" && !current_tenant.email_domain_verified?
      current_tenant.update!(email_domain_verified: true)
    end

    render json: {
      domain: domain,
      verification_token: result.verification_token,
      dkim_tokens: dkim.dkim_tokens,
      records: records,
      verification_status: status&.verification_status || "Pending",
      auto_dns: auto_dns,
      managed_zone: Email::DnsAutoConfigurator.managed_zone_for(domain)
    }
  rescue Aws::SES::Errors::ServiceError => e
    Rails.logger.error "SES verify_domain failed (#{domain}): #{e.class}: #{e.message}"
    render json: { error: e.message, code: e.class.name.demodulize }, status: :unprocessable_entity
  end

  # POST /settings/check_domain_verification
  # Polls SES for verification status. Self-heals: if no identity exists yet
  # (e.g. user clicked Verify before creating one), this triggers the
  # creation flow so the next poll returns useful state instead of unknown.
  def check_domain_verification
    domain = current_tenant.email_domain
    return render json: { verified: false, status: "no_domain" } unless domain.present?

    ses = SesClient.for(current_tenant)
    result = ses.get_identity_verification_attributes(identities: [ domain ])
    attrs = result.verification_attributes[domain]

    if attrs.nil?
      # Identity doesn't exist in SES yet — kick off creation so subsequent
      # polls have something to look at. Caller will hit verify_domain to
      # get the actual records, but this avoids a permanent "unknown" state.
      ses.verify_domain_identity(domain: domain) rescue nil
      return render json: { verified: false, status: "Pending", initialized: true }
    end

    verified = attrs.verification_status == "Success"
    current_tenant.update!(email_domain_verified: true) if verified && !current_tenant.email_domain_verified?

    render json: { verified: verified, status: attrs.verification_status || "unknown" }
  rescue Aws::SES::Errors::ServiceError => e
    Rails.logger.error "SES check_domain_verification failed (#{domain}): #{e.class}: #{e.message}"
    render json: { error: e.message, code: e.class.name.demodulize }, status: :unprocessable_entity
  end

  private

  # If reset_email_domain stashed an old domain in the session, replay it now
  # that a new domain is set — renames every email ChannelConfig over and
  # EngineSyncs each affected agent.
  def run_pending_email_migration!(new_domain)
    from = session.delete(:pending_email_migration_from)
    return 0 if from.blank? || new_domain.blank? || from.casecmp(new_domain).zero?
    Email::DomainMigration.migrate!(current_tenant, from: from, to: new_domain)
  rescue StandardError => e
    Rails.logger.warn "[Settings] email-domain auto-migration failed: #{e.class}: #{e.message}"
    0
  end

  def organization_params
    params.require(:organization).permit(:name, :email_domain, :context_md, :default_slack_agent_id)
  end

  # Strict subdomain label: lowercase, alphanum + hyphen, 1-63 chars, can't
  # start/end with hyphen. Matches DNS RFC 1035 label rules.
  def sanitize_subdomain_label(raw)
    cleaned = raw.to_s.downcase.gsub(/[^a-z0-9-]/, "-").gsub(/-+/, "-").gsub(/\A-|-\z/, "")
    return nil if cleaned.empty? || cleaned.length > 63
    cleaned
  end

  def build_dns_records(domain, verification_token, dkim_tokens)
    region = current_tenant.email_aws_region.presence || ENV.fetch("AWS_REGION", "us-east-1")
    records = [
      { type: "TXT", name: "_amazonses.#{domain}", value: verification_token, purpose: "Domain verification" }
    ]
    dkim_tokens.each do |token|
      records << { type: "CNAME", name: "#{token}._domainkey.#{domain}", value: "#{token}.dkim.amazonses.com", purpose: "DKIM signing" }
    end
    records << { type: "TXT", name: domain, value: "v=spf1 include:amazonses.com ~all", purpose: "SPF" }
    records << { type: "MX", name: domain, value: "10 inbound-smtp.#{region}.amazonaws.com", purpose: "Inbound email" }
    records
  end
end
