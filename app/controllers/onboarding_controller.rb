class OnboardingController < ApplicationController
  before_action :authenticate_user!

  def show
    render inertia: "onboarding/show", props: {
      organization: current_tenant.as_json(only: [:id, :name, :slug, :website_url, :company_summary, :onboarding_completed_at]),
      suggested_website: suggested_website_from_email
    }
  end

  # POST /onboarding/analyze — save website URL and kick off AI analysis
  def analyze
    url = params[:website_url].to_s.strip
    url = "https://#{url}" unless url.start_with?("http")

    current_tenant.update!(website_url: url, company_summary: nil, website_analysis_error: nil)
    WebsiteAnalysisJob.perform_later(current_tenant.id)

    render json: { status: "analyzing" }
  end

  # GET /onboarding/status — poll for analysis completion
  def status
    org = current_tenant.reload
    render json: {
      company_summary: org.company_summary,
      analyzing: org.company_summary.blank? && org.website_analysis_error.blank? && org.website_url.present?,
      error: org.website_analysis_error
    }
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
end
