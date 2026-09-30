class PendingApproval < ApplicationRecord
  acts_as_tenant :organization
  belongs_to :organization
  belongs_to :agent
  # Optional: the inbound message that triggered this approval. The FK uses
  # ON DELETE SET NULL so destroying the message (e.g. via the agent's
  # conversations cascade) nulls this pointer instead of raising a
  # ForeignKeyViolation mid-cascade.
  belongs_to :message, optional: true
  belongs_to :reviewed_by, class_name: "User", optional: true

  validates :tool_name, presence: true
  validates :status, presence: true, inclusion: { in: %w[pending approved rejected] }

  # Post a Block Kit approval card to Slack if the agent has a Slack channel
  # connected. The service short-circuits when there's no channel — so this
  # is safe for every PendingApproval.create! call site. Runs after_commit
  # so Rails-side creates (slack_messages_controller, …) are covered. Engine
  # direct-inserts use the duplicate fan-in path via Api::AgentEventsController.
  after_commit :post_slack_approval_card, on: :create

  # Push the user's decision into the engine's approval pubsub channel so the
  # request_approval tool's await unblocks — or, when the requesting run has
  # already released its turn, so the engine resumes the work in a new job.
  # "connected" is the decision an agent's Connect card resolves to once the
  # user finishes connecting; the resumed run has the new tools loaded.
  def publish_decision!
    msg = {
      type: "action_approval_response",
      approvalToken: approval_token,
      value: decision,
      text: decision_text,
      # Context for the engine's continuation job (fired when the requesting
      # run already released its turn): what was approved, and where the work
      # originated so the resumed reply lands in the right channel.
      summary: try(:summary),
      originChannel: try(:origin),
      # Who decided — the resumed run acts for them (e.g. uses their MCP sign-in).
      userId: reviewed_by_id
    }.to_json
    redis = Redis.new(url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0"))
    redis.publish("agent-#{agent_id}-approvals", msg)
    Rails.logger.info "ActionApproval ##{id}: published #{decision} to engine"

    # Scale-to-zero: pub/sub is fire-and-forget — a sleeping engine has no
    # subscriber and the decision would be lost. Queue a durable continuation
    # through the inbox (drained on boot) and wake the machine. jobId matches
    # the gateway's own continuation id, so if the engine WAS awake and
    # already enqueued one, BullMQ dedupes and this copy is ignored.
    if agent&.status == "sleeping"
      instruction =
        if decision == "connected"
          "The user just finished connecting what you asked for (#{try(:summary) || payload_type}). " \
          "Its tools are loaded now — pick their original request back up and complete it."
        else
          "The user just decided on your earlier approval request " \
          "(#{try(:summary) || payload_type}): #{decision}" \
          "#{decision_text.present? ? " — #{decision_text}" : ''}. " \
          "Continue that work accordingly; do not re-request approval."
        end
      AgentEventBus.publish(
        type: "scheduled_task",
        agent: agent,
        channel: try(:origin).presence || "web",
        job_id: "approval-resume-#{approval_token}",
        payload: {
          instruction: instruction,
          # Structured echo of the decision. The engine replays it as an
          # email pre-approval so an approved email_draft doesn't get stopped
          # a SECOND time by the send_email draft policy — the user already
          # said yes, and that second card is invisible on a resumed run.
          approvalPayloadType: payload_type,
          approvalDecision: decision,
          approvalSummary: try(:summary),
          user_id: reviewed_by_id
        }
      )
    end
  rescue => e
    Rails.logger.error "ActionApproval publish failed: #{e.message}"
  end

  private

  def post_slack_approval_card
    Slack::ApprovalCard.post(self)
  rescue StandardError => e
    Rails.logger.warn "[PendingApproval] Slack card post failed: #{e.class}: #{e.message}"
  end
end
