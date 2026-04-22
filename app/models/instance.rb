class Instance < ApplicationRecord
  belongs_to :agent

  PROVIDERS = %w[fly hetzner aws digitalocean local].freeze
  STATUSES  = %w[pending provisioning running stopped failed terminated].freeze

  validates :status,   presence: true, inclusion: { in: STATUSES }
  validates :provider, presence: true, inclusion: { in: PROVIDERS }

  scope :active, -> { where.not(status: "terminated") }
end
