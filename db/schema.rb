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

ActiveRecord::Schema[8.1].define(version: 2026_04_28_190000) do
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

  create_table "agent_summaries", force: :cascade do |t|
    t.bigint "agent_id", null: false
    t.integer "approvals_approved", default: 0
    t.integer "approvals_pending", default: 0
    t.integer "approvals_rejected", default: 0
    t.jsonb "channel_breakdown", default: {}
    t.integer "conversations_started", default: 0
    t.datetime "created_at", null: false
    t.date "date", null: false
    t.integer "emails_sent", default: 0
    t.integer "errors_count", default: 0
    t.integer "messages_handled", default: 0
    t.bigint "organization_id", null: false
    t.integer "tasks_completed", default: 0
    t.datetime "updated_at", null: false
    t.index ["agent_id", "date"], name: "index_agent_summaries_on_agent_id_and_date", unique: true
    t.index ["agent_id"], name: "index_agent_summaries_on_agent_id"
    t.index ["organization_id"], name: "index_agent_summaries_on_organization_id"
  end

  create_table "agent_templates", force: :cascade do |t|
    t.jsonb "capabilities", default: {}, null: false
    t.datetime "created_at", null: false
    t.text "description"
    t.string "icon"
    t.text "identity_md"
    t.text "instructions_md"
    t.string "name", null: false
    t.text "personality_md"
    t.string "role", null: false
    t.string "slug", null: false
    t.string "suggested_manager_role"
    t.string "suggested_model"
    t.string "suggested_provider", default: "anthropic", null: false
    t.jsonb "suggested_skill_slugs", default: [], null: false
    t.boolean "system_template", default: true, null: false
    t.datetime "updated_at", null: false
    t.jsonb "variables", default: [], null: false
    t.index ["role"], name: "index_agent_templates_on_role"
    t.index ["slug"], name: "index_agent_templates_on_slug", unique: true
  end

  create_table "agent_tool_policies", force: :cascade do |t|
    t.bigint "agent_id", null: false
    t.jsonb "allowed_tools", default: [], null: false
    t.datetime "created_at", null: false
    t.jsonb "denied_tools", default: [], null: false
    t.bigint "organization_id", null: false
    t.string "preset", default: "read_write", null: false
    t.string "toolkit_slug", null: false
    t.datetime "updated_at", null: false
    t.index ["agent_id", "toolkit_slug"], name: "idx_agent_tool_policies_unique", unique: true
    t.index ["agent_id"], name: "index_agent_tool_policies_on_agent_id"
    t.index ["organization_id"], name: "index_agent_tool_policies_on_organization_id"
  end

  create_table "agents", force: :cascade do |t|
    t.string "approval_mode", default: "manual", null: false
    t.jsonb "capabilities", default: {}, null: false
    t.jsonb "command_allowlist", default: []
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
    t.index ["capabilities"], name: "index_agents_on_capabilities", using: :gin
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
    t.jsonb "active_capabilities", default: {}, null: false
    t.bigint "agent_id"
    t.integer "cache_creation_input_tokens"
    t.integer "cache_read_input_tokens"
    t.string "conversation_id_ref"
    t.datetime "created_at", null: false
    t.integer "duration_ms"
    t.integer "first_token_ms"
    t.jsonb "input", default: {}
    t.integer "input_tokens"
    t.string "job_id"
    t.string "model_id"
    t.bigint "organization_id", null: false
    t.jsonb "output", default: {}
    t.integer "output_tokens"
    t.jsonb "routed_toolkits", default: []
    t.jsonb "spans", default: []
    t.string "status"
    t.bigint "task_id"
    t.string "tool_name"
    t.decimal "total_cost_usd", precision: 10, scale: 6
    t.datetime "updated_at", null: false
    t.boolean "was_resume", default: false, null: false
    t.index ["agent_id", "created_at"], name: "index_audit_logs_on_agent_id_and_created_at"
    t.index ["agent_id"], name: "index_audit_logs_on_agent_id"
    t.index ["duration_ms"], name: "index_audit_logs_on_duration_ms"
    t.index ["job_id"], name: "index_audit_logs_on_job_id"
    t.index ["model_id"], name: "index_audit_logs_on_model_id"
    t.index ["organization_id", "created_at"], name: "index_audit_logs_on_organization_id_and_created_at"
    t.index ["organization_id"], name: "index_audit_logs_on_organization_id"
    t.index ["routed_toolkits"], name: "index_audit_logs_on_routed_toolkits", using: :gin
    t.index ["task_id"], name: "index_audit_logs_on_task_id"
    t.index ["total_cost_usd"], name: "index_audit_logs_on_total_cost_usd"
    t.index ["was_resume"], name: "index_audit_logs_on_was_resume"
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
    t.datetime "health_checked_at"
    t.string "instance_type", default: "t3.micro"
    t.string "machine_id"
    t.string "machine_type"
    t.string "private_ip"
    t.string "provider", default: "fly", null: false
    t.text "provisioning_error"
    t.string "public_ip"
    t.string "region", default: "us-east-1"
    t.datetime "started_at"
    t.string "status", default: "pending", null: false
    t.datetime "stopped_at"
    t.datetime "updated_at", null: false
    t.index ["agent_id"], name: "index_instances_on_agent_id", unique: true
    t.index ["provider", "machine_id"], name: "index_instances_on_provider_and_machine_id"
  end

  create_table "integrations", force: :cascade do |t|
    t.string "composio_connection_id"
    t.datetime "created_at", null: false
    t.bigint "organization_id", null: false
    t.bigint "owner_user_id"
    t.string "scope", default: "org", null: false
    t.string "scopes", default: [], array: true
    t.string "service_name", null: false
    t.string "status", default: "connected", null: false
    t.datetime "updated_at", null: false
    t.index ["organization_id", "scope", "owner_user_id", "service_name"], name: "idx_integrations_lookup", unique: true
    t.index ["organization_id", "service_name"], name: "index_integrations_on_organization_id_and_service_name"
    t.index ["organization_id"], name: "index_integrations_on_organization_id"
    t.index ["scope", "owner_user_id"], name: "index_integrations_on_scope_and_owner_user_id"
    t.index ["scope"], name: "index_integrations_on_scope"
  end

  create_table "invitations", force: :cascade do |t|
    t.datetime "accepted_at"
    t.datetime "created_at", null: false
    t.string "email", null: false
    t.datetime "expires_at", null: false
    t.bigint "invited_by_id", null: false
    t.bigint "organization_id", null: false
    t.string "role", default: "member", null: false
    t.string "token", null: false
    t.datetime "updated_at", null: false
    t.index ["invited_by_id"], name: "index_invitations_on_invited_by_id"
    t.index ["organization_id", "email"], name: "index_invitations_on_organization_id_and_email", unique: true, where: "(accepted_at IS NULL)"
    t.index ["organization_id"], name: "index_invitations_on_organization_id"
    t.index ["token"], name: "index_invitations_on_token", unique: true
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

  create_table "oauth_credentials", force: :cascade do |t|
    t.text "access_token_ciphertext"
    t.string "account_email"
    t.string "account_id"
    t.datetime "created_at", null: false
    t.datetime "expires_at"
    t.string "kind", default: "ai_provider", null: false
    t.datetime "last_refreshed_at"
    t.bigint "organization_id", null: false
    t.string "provider", null: false
    t.text "refresh_token_ciphertext"
    t.string "scope"
    t.datetime "updated_at", null: false
    t.index ["expires_at"], name: "index_oauth_credentials_on_expires_at"
    t.index ["kind"], name: "index_oauth_credentials_on_kind"
    t.index ["organization_id", "provider"], name: "index_oauth_credentials_on_organization_id_and_provider", unique: true
    t.index ["organization_id"], name: "index_oauth_credentials_on_organization_id"
  end

  create_table "organizations", force: :cascade do |t|
    t.text "company_summary"
    t.text "composio_api_key_encrypted"
    t.text "context_md"
    t.datetime "created_at", null: false
    t.string "detected_email_provider"
    t.string "email_aws_region", default: "us-east-1"
    t.string "email_bounce_topic_arn"
    t.string "email_complaint_topic_arn"
    t.string "email_domain"
    t.boolean "email_domain_verified", default: false
    t.string "email_provider", default: "ses_managed"
    t.string "email_sns_topic_arn"
    t.string "name", null: false
    t.datetime "onboarding_completed_at"
    t.string "slug", null: false
    t.datetime "updated_at", null: false
    t.text "website_analysis_error"
    t.string "website_url"
    t.index ["slug"], name: "index_organizations_on_slug", unique: true
  end

  create_table "pending_approvals", force: :cascade do |t|
    t.bigint "agent_id", null: false
    t.string "approval_token"
    t.text "context"
    t.datetime "created_at", null: false
    t.string "decision"
    t.text "decision_text"
    t.bigint "message_id"
    t.jsonb "options", default: [], null: false
    t.bigint "organization_id", null: false
    t.string "payload_type"
    t.datetime "reviewed_at"
    t.bigint "reviewed_by_id"
    t.string "risk_tier", default: "medium", null: false
    t.string "status", default: "pending", null: false
    t.text "summary"
    t.jsonb "tool_input", default: {}
    t.string "tool_name", null: false
    t.datetime "updated_at", null: false
    t.index ["agent_id"], name: "index_pending_approvals_on_agent_id"
    t.index ["approval_token"], name: "index_pending_approvals_on_approval_token", unique: true
    t.index ["message_id"], name: "index_pending_approvals_on_message_id"
    t.index ["organization_id", "status"], name: "index_pending_approvals_on_organization_id_and_status"
    t.index ["organization_id"], name: "index_pending_approvals_on_organization_id"
    t.index ["payload_type"], name: "index_pending_approvals_on_payload_type"
    t.index ["reviewed_by_id"], name: "index_pending_approvals_on_reviewed_by_id"
    t.index ["risk_tier"], name: "index_pending_approvals_on_risk_tier"
  end

  create_table "scheduled_work", force: :cascade do |t|
    t.boolean "active", default: true, null: false
    t.bigint "agent_id", null: false
    t.datetime "created_at", null: false
    t.string "cron_expression"
    t.datetime "fire_at"
    t.text "instruction", null: false
    t.integer "interval_seconds"
    t.datetime "last_run_at"
    t.string "mode", null: false
    t.string "name", null: false
    t.datetime "next_run_at"
    t.bigint "organization_id", null: false
    t.jsonb "payload_extra", default: {}
    t.string "timezone", default: "UTC"
    t.datetime "updated_at", null: false
    t.index ["agent_id", "mode", "active"], name: "index_scheduled_work_on_agent_id_and_mode_and_active"
    t.index ["agent_id"], name: "index_scheduled_work_on_agent_id"
    t.index ["fire_at"], name: "index_scheduled_work_on_fire_at", where: "(((mode)::text = 'once'::text) AND (active = true))"
    t.index ["organization_id"], name: "index_scheduled_work_on_organization_id"
  end

  create_table "skill_bundles", force: :cascade do |t|
    t.jsonb "capability_overrides", default: {}, null: false
    t.datetime "created_at", null: false
    t.string "description"
    t.string "icon"
    t.string "name", null: false
    t.jsonb "skill_slugs", default: [], null: false
    t.string "slug", null: false
    t.datetime "updated_at", null: false
    t.index ["slug"], name: "index_skill_bundles_on_slug", unique: true
  end

  create_table "skill_definitions", force: :cascade do |t|
    t.string "category"
    t.datetime "created_at", null: false
    t.string "description"
    t.string "icon"
    t.string "name"
    t.jsonb "required_capabilities", default: [], null: false
    t.jsonb "required_integrations", default: [], null: false
    t.jsonb "requires_connections", default: []
    t.text "skill_md"
    t.string "slug"
    t.string "source", default: "built_in"
    t.text "system_prompt_fragment"
    t.datetime "updated_at", null: false
    t.index ["slug"], name: "index_skill_definitions_on_slug", unique: true
  end

  create_table "tasks", force: :cascade do |t|
    t.bigint "agent_id", null: false
    t.bigint "assigned_by_agent_id"
    t.bigint "assigned_by_user_id"
    t.jsonb "checkpoint", default: {}
    t.datetime "completed_at"
    t.bigint "conversation_id"
    t.datetime "created_at", null: false
    t.text "description"
    t.datetime "due_at"
    t.text "instruction"
    t.bigint "organization_id", null: false
    t.bigint "parent_task_id"
    t.string "priority", default: "normal", null: false
    t.string "progress_summary"
    t.jsonb "result", default: {}
    t.datetime "started_at"
    t.string "status", default: "todo", null: false
    t.string "title", null: false
    t.datetime "updated_at", null: false
    t.index ["agent_id", "status"], name: "index_tasks_on_agent_id_and_status"
    t.index ["agent_id"], name: "index_tasks_on_agent_id"
    t.index ["assigned_by_agent_id"], name: "index_tasks_on_assigned_by_agent_id"
    t.index ["assigned_by_user_id"], name: "index_tasks_on_assigned_by_user_id"
    t.index ["conversation_id"], name: "index_tasks_on_conversation_id"
    t.index ["organization_id"], name: "index_tasks_on_organization_id"
    t.index ["parent_task_id", "status"], name: "index_tasks_on_parent_and_status"
    t.index ["parent_task_id"], name: "index_tasks_on_parent_task_id"
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
  add_foreign_key "agent_summaries", "agents"
  add_foreign_key "agent_summaries", "organizations"
  add_foreign_key "agent_tool_policies", "agents"
  add_foreign_key "agent_tool_policies", "organizations"
  add_foreign_key "agents", "agents", column: "manager_id"
  add_foreign_key "agents", "organizations"
  add_foreign_key "ai_configs", "agents"
  add_foreign_key "audit_logs", "agents"
  add_foreign_key "audit_logs", "organizations"
  add_foreign_key "audit_logs", "tasks"
  add_foreign_key "channel_configs", "agents"
  add_foreign_key "conversations", "agents"
  add_foreign_key "conversations", "organizations"
  add_foreign_key "conversations", "users"
  add_foreign_key "email_events", "agents"
  add_foreign_key "email_events", "organizations"
  add_foreign_key "email_suppressions", "organizations"
  add_foreign_key "instances", "agents"
  add_foreign_key "integrations", "organizations"
  add_foreign_key "integrations", "users", column: "owner_user_id"
  add_foreign_key "invitations", "organizations"
  add_foreign_key "invitations", "users", column: "invited_by_id"
  add_foreign_key "messages", "conversations"
  add_foreign_key "oauth_credentials", "organizations"
  add_foreign_key "pending_approvals", "agents"
  add_foreign_key "pending_approvals", "messages"
  add_foreign_key "pending_approvals", "organizations"
  add_foreign_key "pending_approvals", "users", column: "reviewed_by_id"
  add_foreign_key "scheduled_work", "agents"
  add_foreign_key "scheduled_work", "organizations"
  add_foreign_key "tasks", "agents"
  add_foreign_key "tasks", "agents", column: "assigned_by_agent_id"
  add_foreign_key "tasks", "conversations"
  add_foreign_key "tasks", "organizations"
  add_foreign_key "tasks", "tasks", column: "parent_task_id"
  add_foreign_key "tasks", "users", column: "assigned_by_user_id"
  add_foreign_key "users", "organizations"
end
