# A whole file made available to an agent's "file finder" — stored as a real
# ActiveStorage blob (S3 in prod), NOT chunked/vectorized like the knowledge
# base. The engine's list_files / read_file tools let the agent browse these
# and read them in full on demand.
#
# Two scopes, mirroring the knowledge base:
#   - "agent": personal to one agent (agent_id set)
#   - "org":   shared across every agent in the org (agent_id nil)
class AgentFile < ApplicationRecord
  acts_as_tenant :organization
  belongs_to :organization
  belongs_to :agent, optional: true

  has_one_attached :file

  SCOPES = %w[agent org].freeze

  validates :scope, presence: true, inclusion: { in: SCOPES }
  validates :title, presence: true
  validates :agent, presence: true, if: -> { scope == "agent" }
  validate  :file_must_be_attached, on: :create

  # Files an agent can see: its own personal files + every org-shared file.
  scope :visible_to_agent, ->(agent) {
    where(scope: "org").or(where(scope: "agent", agent_id: agent.id))
  }

  def org_scoped?
    scope == "org"
  end

  # Shape consumed by the engine list_files tool + the frontend panel.
  def as_engine_json
    blob = file.attached? ? file.blob : nil
    {
      id: id,
      title: title,
      description: description,
      filename: blob&.filename.to_s,
      content_type: blob&.content_type,
      byte_size: blob&.byte_size,
      signed_id: blob&.signed_id,
      scope: scope,
      created_at: created_at&.iso8601
    }
  end

  private

  def file_must_be_attached
    errors.add(:file, "must be attached") unless file.attached?
  end
end
