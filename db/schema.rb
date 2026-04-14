# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_04_14_175614) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"
  enable_extension "pg_trgm"

  create_table "active_storage_attachments", force: :cascade do |t|
    t.bigint "blob_id", null: false
    t.datetime "created_at", null: false
    t.string "name", null: false
    t.bigint "record_id", null: false
    t.string "record_type", null: false
    t.index ["blob_id"], name: "index_active_storage_attachments_on_blob_id"
    t.index ["record_type", "record_id", "name", "blob_id"], name: "index_active_storage_attachments_uniqueness", unique: true
  end

  create_table "active_storage_blobs", force: :cascade do |t|
    t.bigint "byte_size", null: false
    t.string "checksum"
    t.string "content_type"
    t.datetime "created_at", null: false
    t.string "filename", null: false
    t.string "key", null: false
    t.text "metadata"
    t.string "service_name", null: false
    t.index ["key"], name: "index_active_storage_blobs_on_key", unique: true
  end

  create_table "active_storage_variant_records", force: :cascade do |t|
    t.bigint "blob_id", null: false
    t.string "variation_digest", null: false
    t.index ["blob_id", "variation_digest"], name: "index_active_storage_variant_records_uniqueness", unique: true
  end

  create_table "agent_skills", force: :cascade do |t|
    t.bigint "agent_id", null: false
    t.jsonb "config", default: {}
    t.datetime "created_at", null: false
    t.boolean "enabled", default: true
    t.bigint "skill_definition_id", null: false
    t.datetime "updated_at", null: false
    t.index ["agent_id", "skill_definition_id"], name: "idx_agent_skills_unique", unique: true
    t.index ["agent_id"], name: "index_agent_skills_on_agent_id"
    t.index ["skill_definition_id"], name: "index_agent_skills_on_skill_definition_id"
  end

  create_table "agents", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.text "email_signature_md"
    t.boolean "heartbeat_enabled", default: true
    t.integer "heartbeat_interval_minutes", default: 30
    t.text "identity_md"
    t.text "instructions_md"
    t.bigint "manager_id"
    t.text "memory_md"
    t.string "name", null: false
    t.bigint "organization_id", null: false
    t.jsonb "permissions", default: {}
    t.text "personality_md"
    t.string "role", null: false
    t.string "slug", null: false
    t.string "status", default: "pending", null: false
    t.datetime "updated_at", null: false
    t.index ["manager_id"], name: "index_agents_on_manager_id"
    t.index ["organization_id", "slug"], name: "index_agents_on_organization_id_and_slug", unique: true
    t.index ["organization_id"], name: "index_agents_on_organization_id"
  end

  create_table "ai_configs", force: :cascade do |t|
    t.bigint "agent_id", null: false
    t.datetime "created_at", null: false
    t.integer "max_tokens", default: 8192
    t.string "model_id", default: "claude-sonnet-4-20250514", null: false
    t.string "provider", default: "anthropic", null: false
    t.decimal "temperature", precision: 3, scale: 2, default: "0.7"
    t.string "thinking_level", default: "none"
    t.datetime "updated_at", null: false
    t.index ["agent_id"], name: "index_ai_configs_on_agent_id", unique: true
  end

  create_table "audit_logs", force: :cascade do |t|
    t.string "action", null: false
    t.bigint "agent_id"
    t.datetime "created_at", null: false
    t.jsonb "input", default: {}
    t.bigint "organization_id", null: false
    t.jsonb "output", default: {}
    t.string "status"
    t.string "tool_name"
    t.datetime "updated_at", null: false
    t.index ["agent_id", "created_at"], name: "index_audit_logs_on_agent_id_and_created_at"
    t.index ["agent_id"], name: "index_audit_logs_on_agent_id"
    t.index ["organization_id", "created_at"], name: "index_audit_logs_on_organization_id_and_created_at"
    t.index ["organization_id"], name: "index_audit_logs_on_organization_id"
  end

  create_table "channel_configs", force: :cascade do |t|
    t.bigint "agent_id", null: false
    t.string "channel_type", null: false
    t.jsonb "config", default: {}
    t.datetime "created_at", null: false
    t.boolean "enabled", default: true
    t.string "status", default: "disconnected", null: false
    t.datetime "updated_at", null: false
    t.index ["agent_id", "channel_type"], name: "index_channel_configs_on_agent_id_and_channel_type", unique: true
    t.index ["agent_id"], name: "index_channel_configs_on_agent_id"
  end

  create_table "conversations", force: :cascade do |t|
    t.bigint "agent_id", null: false
    t.string "claude_session_id"
    t.integer "claude_session_turn_count", default: 0, null: false
    t.string "contact_email"
    t.string "contact_identifier"
    t.string "contact_name"
    t.string "contact_phone"
    t.datetime "created_at", null: false
    t.string "kind", default: "external", null: false
    t.datetime "last_message_at"
    t.bigint "organization_id", null: false
    t.string "status", default: "active", null: false
    t.string "subject"
    t.jsonb "summaries", default: []
    t.datetime "updated_at", null: false
    t.bigint "user_id"
    t.index ["agent_id", "contact_identifier"], name: "index_conversations_on_agent_id_and_contact_identifier"
    t.index ["agent_id", "kind"], name: "index_conversations_on_agent_id_and_kind"
    t.index ["agent_id"], name: "index_conversations_on_agent_id"
    t.index ["claude_session_id"], name: "index_conversations_on_claude_session_id"
    t.index ["organization_id"], name: "index_conversations_on_organization_id"
    t.index ["user_id"], name: "index_conversations_on_user_id"
  end

  create_table "email_events", force: :cascade do |t|
    t.bigint "agent_id"
    t.string "bounce_subtype"
    t.string "bounce_type"
    t.datetime "created_at", null: false
    t.text "diagnostic"
    t.string "event_type", null: false
    t.bigint "organization_id", null: false
    t.jsonb "raw", default: {}
    t.string "recipient"
    t.datetime "updated_at", null: false
    t.index ["agent_id"], name: "index_email_events_on_agent_id"
    t.index ["organization_id"], name: "index_email_events_on_organization_id"
    t.index ["recipient", "event_type"], name: "index_email_events_on_recipient_and_event_type"
  end

  create_table "email_suppressions", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "email_address", null: false
    t.bigint "organization_id", null: false
    t.string "reason", null: false
    t.datetime "updated_at", null: false
    t.index ["organization_id", "email_address"], name: "index_email_suppressions_on_organization_id_and_email_address", unique: true
    t.index ["organization_id"], name: "index_email_suppressions_on_organization_id"
  end

  create_table "instances", force: :cascade do |t|
    t.bigint "agent_id", null: false
    t.string "aws_instance_id"
    t.string "aws_ip_address"
    t.string "aws_volume_id"
    t.datetime "created_at", null: false
    t.string "instance_type", default: "t3.micro"
    t.string "region", default: "us-east-1"
    t.datetime "started_at"
    t.string "status", default: "pending", null: false
    t.datetime "stopped_at"
    t.datetime "updated_at", null: false
    t.index ["agent_id"], name: "index_instances_on_agent_id", unique: true
  end

  create_table "integrations", force: :cascade do |t|
    t.string "composio_connection_id"
    t.datetime "created_at", null: false
    t.bigint "organization_id", null: false
    t.string "scopes", default: [], array: true
    t.string "service_name", null: false
    t.string "status", default: "connected", null: false
    t.datetime "updated_at", null: false
    t.index ["organization_id", "service_name"], name: "index_integrations_on_organization_id_and_service_name"
    t.index ["organization_id"], name: "index_integrations_on_organization_id"
  end

  create_table "messages", force: :cascade do |t|
    t.string "channel"
    t.text "content", null: false
    t.bigint "conversation_id", null: false
    t.datetime "created_at", null: false
    t.string "direction"
    t.jsonb "metadata", default: {}
    t.string "role", null: false
    t.jsonb "tool_calls", default: []
    t.datetime "updated_at", null: false
    t.index "((metadata ->> 'message_id'::text))", name: "index_messages_on_metadata_message_id", where: "(metadata ? 'message_id'::text)"
    t.index ["content"], name: "index_messages_on_content_trgm", opclass: :gin_trgm_ops, using: :gin
    t.index ["conversation_id", "created_at"], name: "index_messages_on_conversation_id_and_created_at"
    t.index ["conversation_id"], name: "index_messages_on_conversation_id"
  end

  create_table "organizations", force: :cascade do |t|
    t.text "composio_api_key_encrypted"
    t.text "context_md"
    t.datetime "created_at", null: false
    t.string "email_aws_region", default: "us-east-1"
    t.string "email_bounce_topic_arn"
    t.string "email_complaint_topic_arn"
    t.string "email_domain"
    t.boolean "email_domain_verified", default: false
    t.string "email_provider", default: "ses_managed"
    t.string "email_sns_topic_arn"
    t.string "name", null: false
    t.string "slug", null: false
    t.datetime "updated_at", null: false
    t.index ["slug"], name: "index_organizations_on_slug", unique: true
  end

  create_table "pending_approvals", force: :cascade do |t|
    t.bigint "agent_id", null: false
    t.text "context"
    t.datetime "created_at", null: false
    t.bigint "message_id"
    t.bigint "organization_id", null: false
    t.datetime "reviewed_at"
    t.bigint "reviewed_by_id"
    t.string "status", default: "pending", null: false
    t.jsonb "tool_input", default: {}
    t.string "tool_name", null: false
    t.datetime "updated_at", null: false
    t.index ["agent_id"], name: "index_pending_approvals_on_agent_id"
    t.index ["message_id"], name: "index_pending_approvals_on_message_id"
    t.index ["organization_id", "status"], name: "index_pending_approvals_on_organization_id_and_status"
    t.index ["organization_id"], name: "index_pending_approvals_on_organization_id"
    t.index ["reviewed_by_id"], name: "index_pending_approvals_on_reviewed_by_id"
  end

  create_table "scheduled_tasks", force: :cascade do |t|
    t.boolean "active", default: true
    t.bigint "agent_id", null: false
    t.datetime "created_at", null: false
    t.string "cron_expression", null: false
    t.text "instruction", null: false
    t.datetime "last_run_at"
    t.string "name", null: false
    t.datetime "next_run_at"
    t.bigint "organization_id", null: false
    t.string "timezone", default: "UTC"
    t.datetime "updated_at", null: false
    t.index ["agent_id"], name: "index_scheduled_tasks_on_agent_id"
    t.index ["organization_id"], name: "index_scheduled_tasks_on_organization_id"
  end

  create_table "skill_definitions", force: :cascade do |t|
    t.string "category"
    t.datetime "created_at", null: false
    t.string "description"
    t.string "icon"
    t.string "name"
    t.jsonb "requires_connections", default: []
    t.text "skill_md"
    t.string "slug"
    t.string "source", default: "built_in"
    t.datetime "updated_at", null: false
    t.index ["slug"], name: "index_skill_definitions_on_slug", unique: true
  end

  create_table "tasks", force: :cascade do |t|
    t.bigint "agent_id", null: false
    t.bigint "assigned_by_agent_id"
    t.bigint "assigned_by_user_id"
    t.datetime "completed_at"
    t.datetime "created_at", null: false
    t.text "description"
    t.datetime "due_at"
    t.text "instruction"
    t.bigint "organization_id", null: false
    t.string "priority", default: "normal", null: false
    t.jsonb "result", default: {}
    t.datetime "started_at"
    t.string "status", default: "todo", null: false
    t.string "title", null: false
    t.datetime "updated_at", null: false
    t.index ["agent_id", "status"], name: "index_tasks_on_agent_id_and_status"
    t.index ["agent_id"], name: "index_tasks_on_agent_id"
    t.index ["assigned_by_agent_id"], name: "index_tasks_on_assigned_by_agent_id"
    t.index ["assigned_by_user_id"], name: "index_tasks_on_assigned_by_user_id"
    t.index ["organization_id"], name: "index_tasks_on_organization_id"
  end

  create_table "users", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "email", default: "", null: false
    t.string "encrypted_password", default: "", null: false
    t.string "name", null: false
    t.bigint "organization_id", null: false
    t.datetime "remember_created_at"
    t.datetime "reset_password_sent_at"
    t.string "reset_password_token"
    t.string "role", default: "member", null: false
    t.datetime "updated_at", null: false
    t.index ["email"], name: "index_users_on_email", unique: true
    t.index ["organization_id"], name: "index_users_on_organization_id"
    t.index ["reset_password_token"], name: "index_users_on_reset_password_token", unique: true
  end

  add_foreign_key "active_storage_attachments", "active_storage_blobs", column: "blob_id"
  add_foreign_key "active_storage_variant_records", "active_storage_blobs", column: "blob_id"
  add_foreign_key "agent_skills", "agents"
  add_foreign_key "agent_skills", "skill_definitions"
  add_foreign_key "agents", "agents", column: "manager_id"
  add_foreign_key "agents", "organizations"
  add_foreign_key "ai_configs", "agents"
  add_foreign_key "audit_logs", "agents"
  add_foreign_key "audit_logs", "organizations"
  add_foreign_key "channel_configs", "agents"
  add_foreign_key "conversations", "agents"
  add_foreign_key "conversations", "organizations"
  add_foreign_key "conversations", "users"
  add_foreign_key "email_events", "agents"
  add_foreign_key "email_events", "organizations"
  add_foreign_key "email_suppressions", "organizations"
  add_foreign_key "instances", "agents"
  add_foreign_key "integrations", "organizations"
  add_foreign_key "messages", "conversations"
  add_foreign_key "pending_approvals", "agents"
  add_foreign_key "pending_approvals", "messages"
  add_foreign_key "pending_approvals", "organizations"
  add_foreign_key "pending_approvals", "users", column: "reviewed_by_id"
  add_foreign_key "scheduled_tasks", "agents"
  add_foreign_key "scheduled_tasks", "organizations"
  add_foreign_key "tasks", "agents"
  add_foreign_key "tasks", "agents", column: "assigned_by_agent_id"
  add_foreign_key "tasks", "organizations"
  add_foreign_key "tasks", "users", column: "assigned_by_user_id"
  add_foreign_key "users", "organizations"
end
