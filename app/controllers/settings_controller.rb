class SettingsController < ApplicationController
  before_action :authenticate_user!

  # GET /settings/subdomain_availability?label=acme[&zone=double.md]
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

  # POST /settings/reset_email_domain
  # Clears the org's email_domain so the picker shows again. We don't
  # touch the SES identity / Route 53 records — those are cheap and
  # idempotent on re-pick. If the user re-claims the same name they
  # land on a fully-verified state immediately.
  def reset_email_domain
    current_tenant.update!(email_domain: nil, email_domain_verified: false)
    redirect_to settings_path, notice: "Email domain cleared — pick a new subdomain to start over"
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
    redirect_to settings_path(connect: 1), notice: "Claimed #{requested}; we'll auto-configure DNS now."
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

    render inertia: "settings/show", props: {
      organization: current_tenant.as_json(only: [:id, :name, :slug, :email_domain, :email_domain_verified, :context_md, :email_provider, :email_aws_region]),
      members: current_tenant.users.order(:name).as_json(only: [:id, :name, :email, :role, :created_at]),
      anthropic_account: {
        provider: "anthropic",
        connected: anthropic_cred.present?,
        account_email: anthropic_cred&.account_email,
        expires_at: anthropic_cred&.expires_at,
        last_refreshed_at: anthropic_cred&.last_refreshed_at,
      },
      managed_dns: {
        zones: Email::DnsAutoConfigurator.available_zones,
        suggested_subdomain: Email::DnsAutoConfigurator.suggested_subdomain_for(current_tenant.slug),
        auto_connect: params[:connect] == "1",
      },
    }
  end

  def update
    if current_tenant.update(organization_params)
      redirect_to settings_path, notice: "Settings updated"
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
    status = ses.get_identity_verification_attributes(identities: [domain]).verification_attributes[domain]
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
      managed_zone: Email::DnsAutoConfigurator.managed_zone_for(domain),
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
    result = ses.get_identity_verification_attributes(identities: [domain])
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

  def organization_params
    params.require(:organization).permit(:name, :email_domain, :context_md, :email_provider, :email_aws_region)
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
      { type: "TXT", name: "_amazonses.#{domain}", value: verification_token, purpose: "Domain verification" },
    ]
    dkim_tokens.each do |token|
      records << { type: "CNAME", name: "#{token}._domainkey.#{domain}", value: "#{token}.dkim.amazonses.com", purpose: "DKIM signing" }
    end
    records << { type: "TXT", name: domain, value: "v=spf1 include:amazonses.com ~all", purpose: "SPF" }
    records << { type: "MX", name: domain, value: "10 inbound-smtp.#{region}.amazonaws.com", purpose: "Inbound email" }
    records
  end
end
