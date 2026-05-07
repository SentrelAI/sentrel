class ApprovalRule < ApplicationRecord
  has_prefix_id :aprl

  belongs_to :organization
  belongs_to :agent, optional: true

  validates :auto_decision, presence: true, inclusion: { in: %w[approve reject] }
  validates :predicate, presence: true

  scope :enabled, -> { where(enabled: true) }

  # Find the first rule that matches a request_approval call. Returns nil
  # when no rule matches. Caller (the engine via /api/approval_rules/match)
  # auto-resolves the approval with rule.auto_decision when one matches.
  def self.match(org_id:, agent_id: nil, payload_type: nil, payload: {})
    scope = where(organization_id: org_id, enabled: true)
    scope = scope.where(agent_id: [agent_id, nil]) if agent_id
    scope = scope.where(payload_type: [payload_type, nil]) if payload_type
    scope
      .order(Arel.sql("agent_id IS NULL ASC, payload_type IS NULL ASC"))
      .find { |rule| ApprovalPredicate.match?(rule.predicate, payload, rule_id: rule.id) }
  end
end
