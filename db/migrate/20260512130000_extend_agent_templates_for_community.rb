class ExtendAgentTemplatesForCommunity < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def change
    add_column :agent_templates, :organization_id,    :bigint  unless column_exists?(:agent_templates, :organization_id)
    add_column :agent_templates, :created_by_user_id, :bigint  unless column_exists?(:agent_templates, :created_by_user_id)
    add_column :agent_templates, :published,          :boolean, default: false, null: false unless column_exists?(:agent_templates, :published)
    add_column :agent_templates, :install_count,      :integer, default: 0, null: false unless column_exists?(:agent_templates, :install_count)
    add_column :agent_templates, :category,           :string  unless column_exists?(:agent_templates, :category)

    add_index :agent_templates, :organization_id, algorithm: :concurrently unless index_exists?(:agent_templates, :organization_id)
    add_index :agent_templates, :published,       algorithm: :concurrently unless index_exists?(:agent_templates, :published)
    add_index :agent_templates, :category,        algorithm: :concurrently unless index_exists?(:agent_templates, :category)

    unless foreign_key_exists?(:agent_templates, :organizations)
      add_foreign_key :agent_templates, :organizations, validate: false
    end
    unless foreign_key_exists?(:agent_templates, :users, column: :created_by_user_id)
      add_foreign_key :agent_templates, :users, column: :created_by_user_id, validate: false
    end

    # Backfill: existing system seeds are global + published, default category.
    say_with_time "Backfilling agent_templates for community visibility" do
      execute <<~SQL.squish
        UPDATE agent_templates
        SET published = TRUE
        WHERE system_template = TRUE AND published = FALSE
      SQL

      # Best-effort categorization based on role keywords. Anything unmatched
      # falls into "starter" so it's still browsable.
      execute <<~SQL.squish
        UPDATE agent_templates SET category = CASE
          WHEN LOWER(role) ~ 'sdr|sales|account' THEN 'sales'
          WHEN LOWER(role) ~ 'support|csm|customer' THEN 'support'
          WHEN LOWER(role) ~ 'marketer|marketing|growth|seo' THEN 'marketing'
          WHEN LOWER(role) ~ 'engineer|developer|ops|sre|devops' THEN 'engineering'
          WHEN LOWER(role) ~ 'recruit|hr|people' THEN 'people'
          WHEN LOWER(role) ~ 'assistant|chief of staff|coordinator|meeting' THEN 'personal'
          ELSE 'starter'
        END
        WHERE category IS NULL
      SQL
    end
  end
end
