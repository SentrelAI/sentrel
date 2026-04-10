class EmailEvent < ApplicationRecord
  acts_as_tenant :organization
  belongs_to :organization
  belongs_to :agent, optional: true

  EVENT_TYPES = %w[bounce complaint delivery].freeze
  validates :event_type, inclusion: { in: EVENT_TYPES }
end
