class Integration < ApplicationRecord
  belongs_to :organization

  validates :service_name, presence: true
  validates :status, presence: true, inclusion: { in: %w[connected disconnected expired] }
end
