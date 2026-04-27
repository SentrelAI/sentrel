# Tiny lookup endpoint for the chat-thread inline approval card. The engine
# emits action_approval events with an approval_token (engine-side correlation
# id, e.g. 'act_3'); the frontend uses that to find the corresponding
# pending_approvals row id so it can PATCH /pending_approvals/:id with the
# user's decision.
class Api::ActionApprovalsController < ApplicationController
  before_action :authenticate_user!

  def by_token
    token = params[:token].to_s
    return head :bad_request if token.blank?

    approval = current_tenant.pending_approvals.find_by(approval_token: token)
    return head :not_found unless approval

    render json: { id: approval.id, status: approval.status }
  end
end
