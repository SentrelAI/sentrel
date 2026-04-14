class Integration < ApplicationRecord
  acts_as_tenant :organization
  belongs_to :organization

  validates :service_name, presence: true
  validates :status, presence: true, inclusion: { in: %w[pending connected disconnected expired] }
end
