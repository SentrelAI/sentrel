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

  private

  # Sprint 1d — include attachments (filename, size, content_type, download URL)
  # so the conversation UI can render download chips on inbound messages.
  def serialize_message(m)
    base = m.as_json(only: [ :id, :role, :content, :direction, :channel, :tool_calls, :metadata, :created_at ])
    base.merge(
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
