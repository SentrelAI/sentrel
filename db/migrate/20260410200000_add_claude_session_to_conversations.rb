class AddClaudeSessionToConversations < ActiveRecord::Migration[8.1]
  def up
    add_column :conversations, :claude_session_id, :string
    add_column :conversations, :claude_session_turn_count, :integer, default: 0, null: false
    add_column :conversations, :last_message_at, :datetime
    add_column :conversations, :summaries, :jsonb, default: []

    add_index :conversations, :claude_session_id

    # Backfill last_message_at from each conversation's most recent message
    execute <<~SQL
      UPDATE conversations c
      SET last_message_at = sub.max_created_at
      FROM (
        SELECT conversation_id, MAX(created_at) AS max_created_at
        FROM messages
        GROUP BY conversation_id
      ) sub
      WHERE c.id = sub.conversation_id
    SQL
  end

  def down
    remove_index :conversations, :claude_session_id
    remove_column :conversations, :summaries
    remove_column :conversations, :last_message_at
    remove_column :conversations, :claude_session_turn_count
    remove_column :conversations, :claude_session_id
  end
end
