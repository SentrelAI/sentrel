class AddSenderFieldsToMessages < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def up
    add_column    :messages, :sender_name,    :string  unless column_exists?(:messages, :sender_name)
    add_column    :messages, :sender_email,   :string  unless column_exists?(:messages, :sender_email)
    add_column    :messages, :sender_user_id, :bigint  unless column_exists?(:messages, :sender_user_id)

    add_index :messages, :sender_user_id, algorithm: :concurrently unless index_exists?(:messages, :sender_user_id)
    unless foreign_key_exists?(:messages, :users)
      add_foreign_key :messages, :users, column: :sender_user_id, validate: false
    end

    # Backfill in batches. Inbound email → metadata.from_name / metadata.from.
    # Outbound email → joined agent name + the agent's email channel address.
    # Web "user" rows (boss → agent) → conversation.user_id / user.name+email.
    # Assistant rows on internal convs → agent.name + agent's primary email.
    say_with_time "Backfilling messages.sender_* (this can take a minute)" do
      execute <<~SQL.squish
        UPDATE messages
        SET sender_name  = COALESCE(metadata->>'from_name', metadata->>'from'),
            sender_email = metadata->>'from'
        WHERE direction = 'inbound'
          AND channel = 'email'
          AND (sender_name IS NULL OR sender_email IS NULL)
      SQL

      execute <<~SQL.squish
        UPDATE messages m
        SET sender_name  = a.name,
            sender_email = COALESCE(
              (SELECT cc.config->>'address'
                 FROM channel_configs cc
                WHERE cc.agent_id = a.id
                  AND cc.channel_type = 'email'
                  AND cc.enabled = TRUE
                ORDER BY cc.id ASC LIMIT 1),
              NULL
            )
        FROM conversations c, agents a
        WHERE m.conversation_id = c.id
          AND c.agent_id = a.id
          AND m.direction = 'outbound'
          AND m.channel = 'email'
          AND (m.sender_name IS NULL OR m.sender_email IS NULL)
      SQL

      execute <<~SQL.squish
        UPDATE messages m
        SET sender_name    = u.name,
            sender_email   = u.email,
            sender_user_id = u.id
        FROM conversations c, users u
        WHERE m.conversation_id = c.id
          AND c.user_id = u.id
          AND m.role = 'user'
          AND m.channel IN ('web', 'internal')
          AND m.sender_user_id IS NULL
      SQL

      execute <<~SQL.squish
        UPDATE messages m
        SET sender_name  = a.name
        FROM conversations c, agents a
        WHERE m.conversation_id = c.id
          AND c.agent_id = a.id
          AND m.role = 'assistant'
          AND m.sender_name IS NULL
      SQL
    end
  end

  def down
    if foreign_key_exists?(:messages, :users)
      remove_foreign_key :messages, column: :sender_user_id
    end
    remove_index :messages, :sender_user_id if index_exists?(:messages, :sender_user_id)
    remove_column :messages, :sender_user_id if column_exists?(:messages, :sender_user_id)
    remove_column :messages, :sender_email   if column_exists?(:messages, :sender_email)
    remove_column :messages, :sender_name    if column_exists?(:messages, :sender_name)
  end
end
