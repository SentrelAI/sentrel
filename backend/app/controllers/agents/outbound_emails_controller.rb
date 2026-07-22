class Agents::OutboundEmailsController < ApplicationController
  before_action :authenticate_user!
  before_action :load_agent

  # POST /agents/:agent_id/outbound_emails
  # Human user composes/replies to an email *as* the agent. Goes through
  # the same SES outbound path as agent-generated mail, but persists the
  # message + audit log row with sender_user_id / acting_user_id so the
  # UI + audit trail clearly attribute it to the human.
  def create
    email_channel = @agent.channel_configs
      .where(channel_type: "email", enabled: true)
      .first

    unless email_channel
      return render json: { error: "Agent has no enabled email channel" }, status: :unprocessable_entity
    end

    address = email_channel.config["address"].to_s
    if address.blank?
      return render json: { error: "Email channel has no address configured" }, status: :unprocessable_entity
    end

    to = Array(params[:to]).reject(&:blank?)
    cc = Array(params[:cc]).reject(&:blank?)
    bcc = Array(params[:bcc]).reject(&:blank?)
    subject = params[:subject].to_s.presence || "(no subject)"
    body_text = params[:body_text].to_s
    body_html = params[:body_html].presence || body_text

    if to.empty?
      return render json: { error: "At least one recipient is required" }, status: :unprocessable_entity
    end

    payload = {
      agent_id: @agent.id,
      org_id: @agent.organization_id,
      to: to,
      cc: cc,
      bcc: bcc,
      subject: subject,
      body_text: body_text,
      body_html: body_html,
      from_address: address,
      # The mailbox belongs to the AGENT — a manually drafted email still
      # arrives as "Nova <nova@acme…>", not the operator's name. Who
      # actually clicked send stays durable via acting_user_id below.
      from_name: @agent.name,
      attachment_ids: Array(params[:attachment_ids]).reject(&:blank?),
      # The crucial bit: outbound_sender consults this for the persisted
      # Message.sender_user_id + AuditLog.acting_user_id. The audit row makes
      # "who actually clicked send" durable for compliance review.
      acting_user_id: current_user.id
    }

    SendEmailJob.perform_later(payload)

    render json: {
      status: "queued",
      from: address,
      to: to,
      subject: subject
    }
  end

  private

  def load_agent
    @agent = find_by_public_id!(current_tenant.agents, params[:agent_id])
  rescue ActiveRecord::RecordNotFound
    render json: { error: "Agent not found" }, status: :not_found
  end
end
