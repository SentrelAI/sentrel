class Instance < ApplicationRecord
  belongs_to :agent

  validates :status, presence: true, inclusion: { in: %w[pending provisioning running stopped terminated] }
end
