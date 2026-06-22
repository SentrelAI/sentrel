# Streamlined onboarding for a freshly created org on mobile. Mirrors the web
# OnboardingController's essential surface: optional website analysis, and a
# complete/skip that flips onboarding_completed_at. The heavier web steps
# (SES mailbox, DNS, provider keys) stay web-only; mobile gets the user onboarded
# and into the app.
class Api::Mobile::OnboardingController < Api::Mobile::BaseController
  def show
    org = current_tenant
    render json: {
      organization: org.as_json(only: [ :id, :name, :slug, :website_url, :company_summary, :onboarding_completed_at ]),
      suggested_website: suggested_website_from_email,
      analyzing: org.company_summary.blank? && org.try(:website_analysis_error).blank? && org.website_url.present?
    }
  end

  # POST /api/mobile/onboarding/analyze { website_url }
  def analyze
    url = params[:website_url].to_s.strip
    return render json: { error: "Enter a website" }, status: :unprocessable_entity if url.blank?
    url = "https://#{url}" unless url.start_with?("http")

    current_tenant.update!(website_url: url, company_summary: nil)
    current_tenant.update!(website_analysis_error: nil) if current_tenant.respond_to?(:website_analysis_error)
    WebsiteAnalysisJob.perform_later(current_tenant.id) if defined?(WebsiteAnalysisJob)
    render json: { status: "analyzing" }
  end

  # POST /api/mobile/onboarding/complete — generate starter agents + finish.
  def complete
    begin
      OnboardingAgentGenerator.new(current_tenant, current_user).generate! if defined?(OnboardingAgentGenerator)
    rescue => e
      Rails.logger.warn("[Mobile::Onboarding] agent generation failed: #{e.class}: #{e.message}")
    end
    current_tenant.update!(onboarding_completed_at: Time.current)
    render json: { ok: true, onboarding_completed: true }
  end

  # POST /api/mobile/onboarding/skip — finish without generating agents.
  def skip
    current_tenant.update!(onboarding_completed_at: Time.current)
    render json: { ok: true, onboarding_completed: true }
  end

  private

  GENERIC_DOMAINS = %w[gmail.com googlemail.com hotmail.com outlook.com live.com yahoo.com icloud.com me.com mac.com aol.com proton.me protonmail.com].freeze

  def suggested_website_from_email
    domain = current_user.email.split("@").last&.downcase
    return nil if domain.blank? || GENERIC_DOMAINS.include?(domain)
    domain
  end
end
