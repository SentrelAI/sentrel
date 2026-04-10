class AddMessageIdIndexToMessages < ActiveRecord::Migration[8.1]
  def change
    # Index on metadata->>'message_id' for fast threading lookups + dedup.
    # Partial index — only for messages that have a message_id (email).
    add_index :messages,
              "(metadata->>'message_id')",
              name: "index_messages_on_metadata_message_id",
              where: "metadata ? 'message_id'"
  end
end
