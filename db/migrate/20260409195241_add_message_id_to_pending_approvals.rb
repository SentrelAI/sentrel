class AddMessageIdToPendingApprovals < ActiveRecord::Migration[8.1]
  def change
    add_reference :pending_approvals, :message, null: true, foreign_key: true
  end
end
