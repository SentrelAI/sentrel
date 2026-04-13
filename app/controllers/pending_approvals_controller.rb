class PendingApprovalsController < ApplicationController
  before_action :authenticate_user!

  def index
    render inertia: "approvals/index", props: {
      approvals: current_tenant.pending_approvals.includes(:agent, :reviewed_by)
        .order(created_at: :desc).map { |a| approval_json(a) }
    }
  end

  def update
    approval = current_tenant.pending_approvals.find(params[:id])
    approval.update!(
      status: params[:status],
      reviewed_by: current_user,
      reviewed_at: Time.current
    )

    # Execute approved actions
    if params[:status] == "approved"
      execute_approved_action(approval)
    end

    redirect_to pending_approvals_path, notice: "Approval #{params[:status]}"
  end

  private

  def execute_approved_action(approval)
    case approval.tool_name
    when "send_email"
      SendEmailJob.perform_later(
        approval.tool_input.merge(
          "agent_id" => approval.agent_id,
          "org_id" => approval.organization_id
        )
      )
    end
  end

  def approval_json(approval)
    approval.as_json(only: [:id, :tool_name, :tool_input, :context, :status, :reviewed_at, :created_at]).merge(
      agent: approval.agent.as_json(only: [:id, :name, :slug]),
      reviewed_by: approval.reviewed_by&.as_json(only: [:id, :name]),
      attachments: resolve_attachments(approval.tool_input)
    )
  end

  # Sprint 1e — resolve attachment_ids in the approval payload to filename +
  # size + content_type so the approval card can preview what will be sent.
  def resolve_attachments(tool_input)
    signed_ids = Array(tool_input.is_a?(Hash) ? tool_input["attachment_ids"] : nil)
    return [] if signed_ids.empty?

    signed_ids.filter_map do |sid|
      blob = ActiveStorage::Blob.find_signed(sid)
      next nil unless blob
      {
        signed_id: sid,
        filename: blob.filename.to_s,
        content_type: blob.content_type,
        byte_size: blob.byte_size,
        url: Rails.application.routes.url_helpers.rails_blob_path(blob, only_path: true),
      }
    rescue => e
      Rails.logger.warn "resolve_attachments: failed for #{sid}: #{e.message}"
      nil
    end
  end
end
