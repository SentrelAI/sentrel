class SettingsController < ApplicationController
  before_action :authenticate_user!

  def show
    render inertia: "settings/show", props: {
      organization: current_tenant.as_json(only: [:id, :name, :slug, :email_domain, :email_domain_verified, :context_md]),
      members: current_tenant.users.order(:name).as_json(only: [:id, :name, :email, :role, :created_at])
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
  def verify_domain
    domain = current_tenant.email_domain
    return render json: { error: "No domain set" }, status: :unprocessable_entity unless domain.present?

    ses = Aws::SES::Client.new
    result = ses.verify_domain_identity(domain: domain)
    dkim = ses.verify_domain_dkim(domain: domain)

    render json: {
      domain: domain,
      verification_token: result.verification_token,
      dkim_tokens: dkim.dkim_tokens,
      records: build_dns_records(domain, result.verification_token, dkim.dkim_tokens),
    }
  rescue Aws::SES::Errors::ServiceError => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  # POST /settings/check_domain_verification
  def check_domain_verification
    domain = current_tenant.email_domain
    return render json: { verified: false, status: "no_domain" } unless domain.present?

    ses = Aws::SES::Client.new
    result = ses.get_identity_verification_attributes(identities: [domain])
    attrs = result.verification_attributes[domain]

    verified = attrs&.verification_status == "Success"
    current_tenant.update!(email_domain_verified: true) if verified

    render json: { verified: verified, status: attrs&.verification_status || "unknown" }
  rescue Aws::SES::Errors::ServiceError => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  private

  def organization_params
    params.require(:organization).permit(:name, :email_domain, :context_md)
  end

  def build_dns_records(domain, verification_token, dkim_tokens)
    records = [
      { type: "TXT", name: "_amazonses.#{domain}", value: verification_token, purpose: "Domain verification" },
    ]
    dkim_tokens.each do |token|
      records << { type: "CNAME", name: "#{token}._domainkey.#{domain}", value: "#{token}.dkim.amazonses.com", purpose: "DKIM signing" }
    end
    records << { type: "TXT", name: domain, value: "v=spf1 include:amazonses.com ~all", purpose: "SPF" }
    records << { type: "MX", name: domain, value: "10 inbound-smtp.#{ENV.fetch('AWS_REGION', 'us-east-1')}.amazonaws.com", purpose: "Inbound email" }
    records
  end
end
