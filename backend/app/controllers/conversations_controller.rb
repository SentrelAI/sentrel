class ConversationsController < ApplicationController
  before_action :authenticate_user!
  before_action :set_agent

  def index
    conversations = @agent.conversations.order(updated_at: :desc)
    conversations = conversations.where(kind: params[:kind]) if params[:kind].present?

    render inertia: "conversations/index", props: {
      agent: @agent.as_json(only: [ :id, :name, :slug, :role ]),
      conversations: conversations.map { |c|
        c.as_json(only: [ :id, :kind, :contact_name, :contact_email, :contact_phone, :subject, :status, :updated_at ]).merge(
          message_count: c.messages.count,
          last_message: c.messages.order(created_at: :desc).first&.as_json(only: [ :content, :role, :channel, :created_at ])
        )
      }
    }
  end

  def show
    conversation = find_by_public_id!(@agent.conversations, params[:id])
    messages = conversation.messages
                           .with_attached_attachments
                           .order(created_at: :asc)

    payload_messages = messages.map { |m| serialize_message(m) }

    respond_to do |format|
      format.json do
        render json: {
          conversation: conversation.as_json(only: [ :id, :kind, :contact_name, :contact_email, :contact_phone, :subject, :status ]).merge(
            channel: messages.last&.channel,
          ),
          messages: payload_messages
        }
      end
      format.html do
        render inertia: "conversations/show", props: {
          agent: @agent.as_json(only: [ :id, :name, :slug, :role ]),
          conversation: conversation.as_json(only: [ :id, :kind, :contact_name, :contact_email, :contact_phone, :subject, :status ]),
          messages: payload_messages
        }
      end
    end
  end

  # Soft-delete: flip status to "archived" so the conversation drops out of
  # the default inbox without losing the underlying history (messages,
  # threading anchors, audit trail). Reversible via #unarchive.
  def archive
    conversation = find_by_public_id!(@agent.conversations, params[:id])
    conversation.update!(status: "archived")
    respond_to do |format|
      format.json { render json: { ok: true, id: conversation.id, status: conversation.status } }
      format.html { redirect_back fallback_location: agent_path(@agent, tab: "inbox") }
    end
  end

  def unarchive
    conversation = find_by_public_id!(@agent.conversations, params[:id])
    conversation.update!(status: "active")
    respond_to do |format|
      format.json { render json: { ok: true, id: conversation.id, status: conversation.status } }
      format.html { redirect_back fallback_location: agent_path(@agent, tab: "inbox") }
    end
  end

  private

  # Sprint 1d — include attachments (filename, size, content_type, download URL)
  # so the conversation UI can render download chips on inbound messages.
  def serialize_message(m)
    # CRITICAL: include sender_name / sender_email / sender_user_id so the
    # conversation timeline displays the ACTUAL sender of each message.
    # Without these the frontend falls back to conversation.contact_name —
    # which is the thread's ORIGINAL sender — and every CC reply / new
    # participant gets mislabeled (e.g. Mohamed's reply showed up as
    # "Abdelmoumin Mokhtari" because Abdel started the thread).
    base = m.as_json(only: [
      :id, :role, :content, :direction, :channel, :tool_calls, :metadata, :created_at,
      :sender_name, :sender_email, :sender_user_id
    ])
    base.merge(
      sender: m.display_sender,
      attachments: m.attachments.map do |att|
        {
          id: att.id,
          filename: att.filename.to_s,
          content_type: att.content_type,
          byte_size: att.byte_size,
          url: Rails.application.routes.url_helpers.rails_blob_path(att, only_path: true)
        }
      end
    )
  end

  def set_agent
    @agent = find_by_public_id!(current_tenant.agents, params[:agent_id])
  end
end
