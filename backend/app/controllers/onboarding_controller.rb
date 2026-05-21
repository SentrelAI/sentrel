class OnboardingController < ApplicationController
  before_action :authenticate_user!

  SUBDOMAIN_PREFIX_RE = /\A[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?\z/

  def show
    render inertia: "onboarding/show", props: {
      organization: current_tenant.as_json(only: [
        :id, :name, :slug, :website_url, :company_summary, :onboarding_completed_at,
        :detected_email_provider, :email_domain, :email_domain_verified
      ]),
      suggested_website: suggested_website_from_email,
      # Surface managed-zone info to onboarding so users can pick a free
      # subdomain on one of our zones instead of bringing their own.
      managed_dns: {
        zones: Email::DnsAutoConfigurator.available_zones,
        suggested_subdomain: Email::DnsAutoConfigurator.suggested_subdomain_for(current_tenant.slug)
      }
    }
  end

  # POST /onboarding/analyze — save website URL and kick off AI analysis
  def analyze
    url = params[:website_url].to_s.strip
    url = "https://#{url}" unless url.start_with?("http")

    current_tenant.update!(
      website_url: url,
      company_summary: nil,
      website_analysis_error: nil,
      detected_email_provider: nil
    )
    WebsiteAnalysisJob.perform_later(current_tenant.id)

    render json: { status: "analyzing" }
  end

  # GET /onboarding/status — poll for analysis completion
  def status
    org = current_tenant.reload
    render json: {
      company_summary: org.company_summary,
      analyzing: org.company_summary.blank? && org.website_analysis_error.blank? && org.website_url.present?,
      error: org.website_analysis_error,
      detected_email_provider: org.detected_email_provider
    }
  end

  # POST /onboarding/setup_mailbox — claim a subdomain and provision SES verification.
  # Body: { subdomain_prefix: "agents" }
  #
  # Uniqueness: one subdomain per organization globally. If another org has
  # already claimed this subdomain, we return 422 with a clear error so the
  # user picks a different name. Re-running for the SAME org (e.g. user
  # navigating back to step 2 to fix a typo) is allowed.
  def setup_mailbox
    prefix = params[:subdomain_prefix].to_s.strip.downcase
    base = base_domain_from_website
    return render json: { error: "Set a website URL before configuring email" }, status: :unprocessable_entity if base.blank?
    return render json: { error: "Choose a subdomain (letters, digits, dashes; up to 32 chars)" }, status: :unprocessable_entity unless prefix.match?(SUBDOMAIN_PREFIX_RE)

    full_domain = "#{prefix}.#{base}"

    # Hard block: any other org already owns this subdomain.
    conflict = ActsAsTenant.without_tenant do
      Organization.where("LOWER(email_domain) = ?", full_domain.downcase)
                  .where.not(id: current_tenant.id)
                  .exists?
    end
    if conflict
      return render json: {
        error: "#{full_domain} is already claimed by another organization. Pick a different subdomain.",
      }, status: :unprocessable_entity
    end

    ses = SesClient.for(current_tenant)
    result = ses.verify_domain_identity(domain: full_domain)
    dkim = ses.verify_domain_dkim(domain: full_domain)

    current_tenant.update!(email_domain: full_domain, email_domain_verified: false)

    render json: {
      domain: full_domain,
      records: build_dns_records(full_domain, result.verification_token, dkim.dkim_tokens),
    }
  rescue ActiveRecord::RecordInvalid => e
    # Catches the model-level uniqueness validation (case the conflict
    # check above missed a race condition).
    render json: { error: e.record.errors.full_messages.join(", ") }, status: :unprocessable_entity
  rescue Aws::SES::Errors::ServiceError => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  # POST /onboarding/verify_mailbox — poll SES for the latest verification status.
  def verify_mailbox
    domain = current_tenant.email_domain
    return render json: { verified: false, status: "no_domain" } if domain.blank?

    ses = SesClient.for(current_tenant)
    result = ses.get_identity_verification_attributes(identities: [ domain ])
    attrs = result.verification_attributes[domain]
    verified = attrs&.verification_status == "Success"
    current_tenant.update!(email_domain_verified: true) if verified

    render json: { verified: verified, status: attrs&.verification_status || "pending" }
  rescue Aws::SES::Errors::ServiceError => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  # POST /onboarding/connect_provider — store the user's AI provider key.
  # Body: { provider: "claude_code" | "anthropic" | "openrouter", value: "..." }
  # Returns JSON so the wizard can stay on-page; skipping is just not calling this.
  def connect_provider
    provider = params[:provider].to_s
    value = params[:value].to_s.strip
    return render json: { error: "Paste a token before continuing" }, status: :unprocessable_entity if value.blank?

    case provider
    when "claude_code"
      import_claude_code_token!(value)
    when "anthropic", "openrouter"
      upsert_llm_api_key!(provider, value)
    else
      return render json: { error: "Unknown provider" }, status: :unprocessable_entity
    end

    render json: { ok: true }
  rescue => e
    Rails.logger.error "[OnboardingController#connect_provider] #{e.class}: #{e.message}"
    render json: { error: e.message }, status: :unprocessable_entity
  end

  # POST /onboarding/complete — generate agents and mark onboarding done
  def complete
    OnboardingAgentGenerator.new(current_tenant, current_user).generate!
    current_tenant.update!(onboarding_completed_at: Time.current)
    redirect_to dashboard_path, notice: "Welcome! Your AI team is ready."
  end

  # POST /onboarding/skip
  def skip
    current_tenant.update!(onboarding_completed_at: Time.current)
    redirect_to dashboard_path
  end

  private

  # Mirrors OauthController#import_token: accepts either the raw
  # ~/.claude/.credentials.json blob or a bare access token.
  def import_claude_code_token!(raw)
    parsed = begin
      json = JSON.parse(raw)
      json["claudeAiOauth"] || json
    rescue JSON::ParserError
      { "accessToken" => raw }
    end

    access = (parsed["accessToken"] || parsed["access_token"]).to_s.strip
    raise "No accessToken in supplied JSON" if access.blank?

    cred = OauthCredential.find_or_initialize_by(
      organization_id: current_tenant.id,
      provider: "anthropic",
    )
    cred.kind             = "ai_provider"
    cred.access_token     = access
    cred.refresh_token    = (parsed["refreshToken"] || parsed["refresh_token"]).to_s.strip.presence
    if parsed["expiresAt"].present?
      cred.expires_at = Time.zone.at(parsed["expiresAt"].to_i / 1000)
    elsif parsed["expires_at"].present?
      cred.expires_at = Time.zone.at(parsed["expires_at"].to_i)
    elsif access.start_with?("sk-ant-oat01-")
      cred.expires_at = 1.year.from_now
    end
    cred.scope = (parsed["scopes"] || parsed["scope"]).is_a?(Array) ? parsed["scopes"].join(" ") : parsed["scope"]
    cred.account_email = parsed["email"] || "Claude Code OAuth"
    cred.last_refreshed_at = Time.current
    cred.save!
  end

  def upsert_llm_api_key!(provider, value)
    cred = current_tenant.credentials.find_or_initialize_by(
      kind: "llm_api_key",
      provider: provider,
      name: "Default #{provider} key",
    )
    cred.created_by_user_id ||= current_user.id
    cred.fields = { "value" => value }
    cred.save!
  end

  GENERIC_DOMAINS = %w[gmail.com googlemail.com hotmail.com outlook.com live.com yahoo.com icloud.com me.com mac.com aol.com protonmail.com proton.me].freeze

  def suggested_website_from_email
    domain = current_user.email.split("@").last&.downcase
    return nil if domain.blank? || GENERIC_DOMAINS.include?(domain)
    domain
  end

  def base_domain_from_website
    return nil if current_tenant.website_url.blank?
    URI.parse(current_tenant.website_url).host.to_s.downcase.sub(/\Awww\./, "").presence
  rescue URI::InvalidURIError
    nil
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
