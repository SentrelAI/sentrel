class TaskComment < ApplicationRecord
  belongs_to :task
  belongs_to :agent, optional: true
  belongs_to :user, optional: true

  has_many_attached :attachments

  validates :content, presence: true
end
