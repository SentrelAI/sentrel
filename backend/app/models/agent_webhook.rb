# An inbound webhook endpoint for an agent. External services (Sentry
# alert rules, GitHub webhooks, Linear, Stripe, anything that can POST
# JSON) hit POST /hooks/:token; the payload is summarized and dispatched
# to the agent's engine as an immediate instruction — the webhook's
# `instruction` says what to do, the payload says what happened.
class AgentWebhook < ApplicationRecord
  acts_as_tenant :organization
  belongs_to :organization
  belongs_to :agent

  SOURCES = %w[generic github sentry linear stripe slack].freeze

  validates :name, presence: true
  validates :instruction, presence: true
  validates :token, presence: true, uniqueness: true
  validates :source, inclusion: { in: SOURCES }

  before_validation :ensure_token, on: :create

  scope :active, -> { where(active: true) }

  def url(base)
    "#{base.to_s.chomp('/')}/hooks/#{token}"
  end

  def record_delivery!
    update_columns(receive_count: receive_count + 1, last_received_at: Time.current)
  end

  private

  def ensure_token
    self.token ||= SecureRandom.urlsafe_base64(24)
  end
end
