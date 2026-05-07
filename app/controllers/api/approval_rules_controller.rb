class Api::ApprovalRulesController < ApplicationController
  skip_before_action :verify_authenticity_token

  before_action :verify_engine_secret!

  # POST /api/approval_rules/match
  # Body: { org_id, agent_id?, payload_type?, payload? }
  # Returns: { auto_decision: "approve"|"reject", rule_id: "aprl_…", label } or 204
  #
  # Engine calls this from the request_approval tool before pausing the run.
  # Hits land in pending_approvals as auto-decided rows so the audit trail
  # stays consistent with manual decisions.
  def match
    rule = ApprovalRule.match(
      org_id: params.require(:org_id),
      agent_id: params[:agent_id],
      payload_type: params[:payload_type],
      payload: params[:payload].to_unsafe_h.presence || {},
    )
    return head :no_content unless rule

    render json: {
      auto_decision: rule.auto_decision,
      rule_id: rule.to_param,
      label: rule.label,
    }
  rescue StandardError => e
    Rails.logger.error("approval_rules#match failed: #{e.class}: #{e.message}")
    render json: { error: e.message }, status: :internal_server_error
  end

  private

  def verify_engine_secret!
    expected = ENV["ENGINE_API_SECRET"].to_s
    given = request.headers["X-Engine-Secret"].to_s
    head :forbidden if expected.blank? || given != expected
  end
end
