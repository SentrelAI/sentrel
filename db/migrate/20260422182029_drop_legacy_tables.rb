class DropLegacyTables < ActiveRecord::Migration[8.0]
  def up
    # task_comments → superseded by messages (conversation-scoped).
    drop_table :task_comments if table_exists?(:task_comments)

    # scheduled_tasks → superseded by scheduled_work (unified cron/once/interval).
    drop_table :scheduled_tasks if table_exists?(:scheduled_tasks)
  end

  def down
    # Dev-only cleanup; no rollback path. Restore from a prior schema
    # snapshot or re-run the originals
    # (20260415210951_create_task_comments, 20260406212209_create_scheduled_tasks)
    # if you genuinely need them back.
    raise ActiveRecord::IrreversibleMigration
  end
end
