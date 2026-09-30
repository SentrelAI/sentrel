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

    # Inline edits from the inbox draft card — whitelisted email fields,
    # merged BEFORE any decision so "Save & send" sends exactly what the
    # user sees. Editing the body as plain text drops any stale body_html;
    # otherwise the html variant would win at send time and silently
    # discard the edit.
    if params[:tool_input_patch].present?
      patch = params[:tool_input_patch].permit(:subject, :body_text, to: [], cc: []).to_h
      patch["body_html"] = nil if patch.key?("body_text")
      approval.update!(tool_input: approval.tool_input.merge(patch)) if patch.any?
    end

    # Save-only: persist the edited draft and stop — it stays pending.
    if params[:save_only].present?
      respond_to do |format|
        format.json { render json: { ok: true, tool_input: approval.tool_input } }
        format.html { redirect_back fallback_location: pending_approvals_path }
      end
      return
    end

    decision_value = params[:decision].presence || params[:status]
    approval.update!(
      status: decision_value == "approve" || decision_value == "approved" ? "approved" : "rejected",
      decision: decision_value,
      decision_text: params[:decision_text].presence,
      reviewed_by: current_user,
      reviewed_at: Time.current,
    )

    # An approved identity card is applied here, before the agent hears the
    # decision — so the reply that follows already runs as the new identity.
    if approval.payload_type == "identity_update" && approval.status == "approved"
      begin
        Agents::IdentityUpdate.apply!(approval, user: current_user)
      rescue Agents::IdentityUpdate::Stale, ActiveRecord::RecordInvalid => e
        approval.update!(status: "rejected", decision: "stale", decision_text: e.message)
      end
    end

    if approval.payload_type.present? && approval.approval_token.present?
      approval.publish_decision!
    elsif decision_value == "approved" || decision_value == "approve"
      execute_approved_action(approval)
    end

    respond_to do |format|
      format.json { render json: { ok: true } }
      format.html { redirect_to pending_approvals_path, notice: "Approval #{decision_value}" }
    end
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
    approval.as_json(only: [
      :id, :tool_name, :tool_input, :context, :status, :reviewed_at, :created_at,
      :summary, :payload_type, :options, :risk_tier, :decision, :decision_text
    ]).merge(
      agent: approval.agent.as_json(only: [ :id, :name, :slug ]),
      reviewed_by: approval.reviewed_by&.as_json(only: [ :id, :name ]),
      attachments: resolve_attachments(approval.tool_input),
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
        url: Rails.application.routes.url_helpers.rails_blob_path(blob, only_path: true)
      }
    rescue => e
      Rails.logger.warn "resolve_attachments: failed for #{sid}: #{e.message}"
      nil
    end
  end
end
