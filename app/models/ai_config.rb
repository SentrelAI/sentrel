class AiConfig < ApplicationRecord
  belongs_to :agent

  validates :provider, presence: true
  validates :model_id, presence: true
end
