class OnboardingController < ApplicationController
  before_action :authenticate_user!

  SUBDOMAIN_PREFIX_RE = /\A[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?\z/

  def show
    render inertia: "onboarding/show", props: {
      organization: current_tenant.as_json(only: [
        :id, :name, :slug, :website_url, :company_summary, :onboarding_completed_at,
        :detected_email_provider, :email_domain, :email_domain_verified
      ]),
      suggested_website: suggested_website_from_email
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
  def setup_mailbox
    prefix = params[:subdomain_prefix].to_s.strip.downcase
    base = base_domain_from_website
    return render json: { error: "Set a website URL before configuring email" }, status: :unprocessable_entity if base.blank?
    return render json: { error: "Choose a subdomain (letters, digits, dashes; up to 32 chars)" }, status: :unprocessable_entity unless prefix.match?(SUBDOMAIN_PREFIX_RE)

    full_domain = "#{prefix}.#{base}"
    current_tenant.update!(email_domain: full_domain, email_domain_verified: false)

    ses = SesClient.for(current_tenant)
    result = ses.verify_domain_identity(domain: full_domain)
    dkim = ses.verify_domain_dkim(domain: full_domain)

    render json: {
      domain: full_domain,
      records: build_dns_records(full_domain, result.verification_token, dkim.dkim_tokens)
    }
  rescue Aws::SES::Errors::ServiceError => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  # POST /onboarding/verify_mailbox — poll SES for the latest verification status.
  def verify_mailbox
    domain = current_tenant.email_domain
    return render json: { verified: false, status: "no_domain" } if domain.blank?

    ses = SesClient.for(current_tenant)
    result = ses.get_identity_verification_attributes(identities: [domain])
    attrs = result.verification_attributes[domain]
    verified = attrs&.verification_status == "Success"
    current_tenant.update!(email_domain_verified: true) if verified

    render json: { verified: verified, status: attrs&.verification_status || "pending" }
  rescue Aws::SES::Errors::ServiceError => e
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
