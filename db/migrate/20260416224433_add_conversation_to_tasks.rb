class AddConversationToTasks < ActiveRecord::Migration[8.1]
  # Step 4 — tasks become durable units that reference a conversation.
  # Each task gets its own chat thread (Conversation + Messages), so agent
  # session resume + prompt caching work naturally on back-and-forth task
  # comments (via conversation.claude_session_id).
  #
  # `checkpoint` + `progress_summary` support Step 5.5 long-running primitives.
  def change
    add_reference :tasks, :conversation, null: true, foreign_key: true
    add_column :tasks, :checkpoint, :jsonb, default: {}
    add_column :tasks, :progress_summary, :string
  end
end
