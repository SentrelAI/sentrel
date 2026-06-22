class AddLastReadAtToConversations < ActiveRecord::Migration[8.1]
  def change
    # When the owning user last read this conversation from mobile. Unread =
    # assistant messages created after this timestamp.
    add_column :conversations, :last_read_at, :datetime
  end
end
