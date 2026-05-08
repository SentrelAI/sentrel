class SettingsController < ApplicationController
  before_action :authenticate_user!

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
