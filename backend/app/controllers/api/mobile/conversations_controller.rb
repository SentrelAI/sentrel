# Powers the mobile "Chat" tab — a Messages-style inbox of the user's internal
# conversations across every agent in the org, newest first, each with its last
# message preview.
class Api::Mobile::ConversationsController < Api::Mobile::BaseController
  def index
    convos = Conversation
      .where(organization_id: current_tenant.id, user_id: current_user.id, kind: "internal")
      .includes(:agent)
      .order(Arel.sql("COALESCE(last_message_at, updated_at) DESC"))
      .limit(50)

    payload = convos.filter_map do |c|
      agent = c.agent
      next unless agent
      last = c.messages.order(created_at: :desc).first
      since = c.last_read_at || Time.at(0)
      unread = c.messages.where(role: "assistant").where("created_at > ?", since).count
      {
        id: c.id,
        agent: { id: agent.to_param, name: agent.name, slug: agent.slug, role: agent.role, status: agent.status },
        last_message: last && {
          role: last.role,
          content: last.content.to_s,
          created_at: last.created_at.iso8601
        },
        last_message_at: (c.last_message_at || c.updated_at)&.iso8601,
        unread_count: unread
      }
    end

    render json: { conversations: payload }
  end
end
