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

ActiveRecord::Schema[8.1].define(version: 2026_06_24_000100) do
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

  create_table "agent_credential_grants", force: :cascade do |t|
    t.bigint "agent_id", null: false
    t.datetime "created_at", null: false
    t.bigint "credential_id", null: false
    t.datetime "updated_at", null: false
    t.index ["agent_id", "credential_id"], name: "index_agent_credential_grants_uniq", unique: true
    t.index ["agent_id"], name: "index_agent_credential_grants_on_agent_id"
    t.index ["credential_id"], name: "index_agent_credential_grants_on_credential_id"
  end

  create_table "agent_files", force: :cascade do |t|
    t.bigint "agent_id"
    t.datetime "created_at", null: false
    t.text "description"
    t.bigint "organization_id", null: false
    t.string "scope", default: "agent", null: false
    t.string "title", null: false
    t.datetime "updated_at", null: false
    t.index ["agent_id"], name: "index_agent_files_on_agent_id"
    t.index ["organization_id", "agent_id"], name: "index_agent_files_on_organization_id_and_agent_id"
    t.index ["organization_id", "scope"], name: "index_agent_files_on_organization_id_and_scope"
    t.index ["organization_id"], name: "index_agent_files_on_organization_id"
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

  create_table "agent_template_versions", force: :cascade do |t|
    t.bigint "agent_template_id", null: false
    t.text "changelog"
    t.datetime "created_at", null: false
    t.bigint "created_by_user_id"
    t.jsonb "definition", default: {}, null: false
    t.string "license"
    t.boolean "published", default: true, null: false
    t.string "spec_version", default: "1.0", null: false
    t.datetime "updated_at", null: false
    t.integer "version_number", null: false
    t.index ["agent_template_id", "created_at"], name: "idx_agent_template_versions_history", order: { created_at: :desc }
    t.index ["agent_template_id", "version_number"], name: "idx_agent_template_versions_unique_per_template", unique: true
    t.index ["agent_template_id"], name: "index_agent_template_versions_on_agent_template_id"
    t.index ["created_by_user_id"], name: "index_agent_template_versions_on_created_by_user_id"
  end

  create_table "agent_templates", force: :cascade do |t|
    t.jsonb "capabilities", default: {}, null: false
    t.string "category"
    t.datetime "created_at", null: false
    t.bigint "created_by_user_id"
    t.bigint "current_version_id"
    t.text "description"
    t.text "email_signature_md"
    t.boolean "featured", default: false, null: false
    t.integer "featured_position"
    t.string "icon"
    t.text "identity_md"
    t.integer "install_count", default: 0, null: false
    t.text "instructions_md"
    t.string "license", default: "CC-BY-4.0", null: false
    t.string "name", null: false
    t.bigint "organization_id"
    t.text "personality_md"
    t.boolean "published", default: false, null: false
    t.string "role", null: false
    t.string "slug", null: false
    t.jsonb "suggested_integrations", default: [], null: false
    t.string "suggested_manager_role"
    t.string "suggested_model"
    t.string "suggested_provider", default: "anthropic", null: false
    t.jsonb "suggested_skill_slugs", default: [], null: false
    t.boolean "system_template", default: true, null: false
    t.datetime "updated_at", null: false
    t.jsonb "variables", default: [], null: false
    t.index ["category"], name: "index_agent_templates_on_category"
    t.index ["current_version_id"], name: "index_agent_templates_on_current_version_id"
    t.index ["featured", "featured_position"], name: "index_agent_templates_on_featured", where: "featured"
    t.index ["organization_id"], name: "index_agent_templates_on_organization_id"
    t.index ["published"], name: "index_agent_templates_on_published"
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

  create_table "agent_webhooks", force: :cascade do |t|
    t.boolean "active", default: true, null: false
    t.bigint "agent_id", null: false
    t.datetime "created_at", null: false
    t.text "instruction", null: false
    t.datetime "last_received_at"
    t.string "name", null: false
    t.bigint "organization_id", null: false
    t.integer "receive_count", default: 0, null: false
    t.string "source", default: "generic", null: false
    t.string "token", null: false
    t.datetime "updated_at", null: false
    t.index ["agent_id"], name: "index_agent_webhooks_on_agent_id"
    t.index ["organization_id"], name: "index_agent_webhooks_on_organization_id"
    t.index ["token"], name: "index_agent_webhooks_on_token", unique: true
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
    t.date "spend_cap_pushed_on"
    t.decimal "spend_daily_cap_usd", precision: 10, scale: 2, default: "15.0"
    t.decimal "spend_monthly_cap_usd", precision: 10, scale: 2, default: "150.0"
    t.date "spend_notified_on"
    t.decimal "spend_notify_threshold_pct", precision: 4, scale: 2, default: "0.8", null: false
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

  create_table "approval_rules", force: :cascade do |t|
    t.bigint "agent_id"
    t.string "auto_decision", null: false
    t.datetime "created_at", null: false
    t.boolean "enabled", default: true, null: false
    t.string "label"
    t.bigint "organization_id", null: false
    t.string "payload_type"
    t.jsonb "predicate", default: {}, null: false
    t.datetime "updated_at", null: false
    t.index ["agent_id"], name: "index_approval_rules_on_agent_id"
    t.index ["organization_id", "enabled", "payload_type"], name: "idx_approval_rules_lookup"
    t.index ["organization_id"], name: "index_approval_rules_on_organization_id"
  end

  create_table "audit_logs", force: :cascade do |t|
    t.bigint "acting_user_id"
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
    t.index ["acting_user_id"], name: "index_audit_logs_on_acting_user_id"
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
    t.text "secret_config"
    t.string "status", default: "disconnected", null: false
    t.datetime "updated_at", null: false
    t.index "((config ->> 'team_id'::text)) text_pattern_ops", name: "idx_channel_configs_slack_team_id", where: "((channel_type)::text = 'slack'::text)"
    t.index ["agent_id", "channel_type"], name: "index_channel_configs_on_agent_id_and_channel_type", unique: true
    t.index ["agent_id"], name: "index_channel_configs_on_agent_id"
  end

  create_table "composio_toolkit_caches", force: :cascade do |t|
    t.boolean "available", default: false, null: false
    t.string "category"
    t.datetime "created_at", null: false
    t.text "description"
    t.string "label"
    t.string "logo"
    t.bigint "organization_id", null: false
    t.datetime "refreshed_at", null: false
    t.string "slug", null: false
    t.datetime "updated_at", null: false
    t.index ["organization_id", "available"], name: "index_composio_toolkit_caches_on_organization_id_and_available"
    t.index ["organization_id", "slug"], name: "idx_composio_toolkit_caches_org_slug", unique: true
    t.index ["organization_id"], name: "index_composio_toolkit_caches_on_organization_id"
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
    t.datetime "last_read_at"
    t.bigint "organization_id", null: false
    t.string "status", default: "active", null: false
    t.string "subject"
    t.jsonb "summaries", default: []
    t.bigint "unified_conversation_id"
    t.datetime "updated_at", null: false
    t.bigint "user_id"
    t.index ["agent_id", "contact_identifier"], name: "index_conversations_on_agent_id_and_contact_identifier"
    t.index ["agent_id", "kind"], name: "index_conversations_on_agent_id_and_kind"
    t.index ["agent_id"], name: "index_conversations_on_agent_id"
    t.index ["claude_session_id"], name: "index_conversations_on_claude_session_id"
    t.index ["organization_id"], name: "index_conversations_on_organization_id"
    t.index ["unified_conversation_id", "updated_at"], name: "index_conversations_on_unified_and_updated"
    t.index ["unified_conversation_id"], name: "index_conversations_on_unified_conversation_id"
    t.index ["user_id"], name: "index_conversations_on_user_id"
  end

  create_table "credentials", force: :cascade do |t|
    t.bigint "agent_id"
    t.datetime "created_at", null: false
    t.bigint "created_by_user_id"
    t.string "kind", null: false
    t.datetime "last_used_at"
    t.jsonb "meta", default: {}, null: false
    t.string "name", null: false
    t.bigint "organization_id", null: false
    t.string "provider", null: false
    t.datetime "updated_at", null: false
    t.text "value_ciphertext"
    t.index ["agent_id", "provider", "kind"], name: "index_credentials_on_agent_id_and_provider_and_kind", where: "(agent_id IS NOT NULL)"
    t.index ["agent_id"], name: "index_credentials_on_agent_id"
    t.index ["created_by_user_id"], name: "index_credentials_on_created_by_user_id"
    t.index ["kind"], name: "index_credentials_on_kind"
    t.index ["organization_id", "agent_id", "provider", "name"], name: "index_credentials_on_org_agent_provider_name", unique: true
    t.index ["organization_id", "provider", "name"], name: "index_credentials_uniq_per_org", unique: true
    t.index ["organization_id"], name: "index_credentials_on_organization_id"
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

  create_table "integration_requests", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "note"
    t.bigint "organization_id", null: false
    t.datetime "resolved_at"
    t.string "service_name", null: false
    t.string "status", default: "pending", null: false
    t.datetime "updated_at", null: false
    t.bigint "user_id", null: false
    t.index ["organization_id", "service_name"], name: "index_integration_requests_on_organization_id_and_service_name"
    t.index ["organization_id"], name: "index_integration_requests_on_organization_id"
    t.index ["user_id", "service_name"], name: "index_integration_requests_on_user_service", unique: true
    t.index ["user_id"], name: "index_integration_requests_on_user_id"
  end

  create_table "integrations", force: :cascade do |t|
    t.string "composio_connection_id"
    t.string "connect_mode", default: "managed", null: false
    t.datetime "created_at", null: false
    t.string "nango_connection_id"
    t.bigint "organization_id", null: false
    t.bigint "owner_user_id"
    t.string "provider_config_key"
    t.string "scope", default: "org", null: false
    t.string "scopes", default: [], array: true
    t.string "service_name", null: false
    t.string "status", default: "connected", null: false
    t.datetime "updated_at", null: false
    t.index ["organization_id", "nango_connection_id"], name: "index_integrations_on_organization_id_and_nango_connection_id"
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

  create_table "mcp_servers", force: :cascade do |t|
    t.text "access_token_ciphertext"
    t.bigint "agent_id"
    t.string "authorize_endpoint"
    t.string "client_id"
    t.datetime "created_at", null: false
    t.boolean "enabled", default: true, null: false
    t.datetime "expires_at"
    t.string "issuer"
    t.text "last_error"
    t.string "name", null: false
    t.bigint "organization_id", null: false
    t.text "refresh_token_ciphertext"
    t.jsonb "scopes", default: [], null: false
    t.string "slug", null: false
    t.string "status", default: "disconnected", null: false
    t.string "token_endpoint"
    t.string "transport", default: "http", null: false
    t.datetime "updated_at", null: false
    t.string "url", null: false
    t.index ["agent_id"], name: "index_mcp_servers_on_agent_id"
    t.index ["organization_id", "slug"], name: "index_mcp_servers_on_organization_id_and_slug", unique: true
    t.index ["organization_id"], name: "index_mcp_servers_on_organization_id"
  end

  create_table "memberships", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.bigint "organization_id", null: false
    t.string "role", default: "member", null: false
    t.datetime "updated_at", null: false
    t.bigint "user_id", null: false
    t.index ["organization_id"], name: "index_memberships_on_organization_id"
    t.index ["user_id", "organization_id"], name: "index_memberships_on_user_id_and_organization_id", unique: true
    t.index ["user_id"], name: "index_memberships_on_user_id"
  end

  create_table "messages", force: :cascade do |t|
    t.string "channel"
    t.text "content", null: false
    t.bigint "conversation_id", null: false
    t.datetime "created_at", null: false
    t.string "direction"
    t.jsonb "metadata", default: {}
    t.string "role", null: false
    t.string "sender_email"
    t.string "sender_name"
    t.bigint "sender_user_id"
    t.jsonb "tool_calls", default: []
    t.datetime "updated_at", null: false
    t.index "((metadata ->> 'message_id'::text))", name: "index_messages_on_metadata_message_id", where: "(metadata ? 'message_id'::text)"
    t.index ["content"], name: "index_messages_on_content_trgm", opclass: :gin_trgm_ops, using: :gin
    t.index ["conversation_id", "created_at"], name: "index_messages_on_conversation_id_and_created_at"
    t.index ["conversation_id"], name: "index_messages_on_conversation_id"
    t.index ["sender_user_id"], name: "index_messages_on_sender_user_id"
  end

  create_table "mobile_devices", force: :cascade do |t|
    t.string "auth_token", null: false
    t.datetime "created_at", null: false
    t.string "device_name"
    t.string "expo_push_token"
    t.datetime "last_seen_at"
    t.string "platform"
    t.datetime "updated_at", null: false
    t.bigint "user_id", null: false
    t.index ["auth_token"], name: "index_mobile_devices_on_auth_token", unique: true
    t.index ["expo_push_token"], name: "index_mobile_devices_on_expo_push_token"
    t.index ["user_id"], name: "index_mobile_devices_on_user_id"
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

  create_table "org_integration_configs", force: :cascade do |t|
    t.string "client_id"
    t.text "client_secret_ciphertext"
    t.datetime "created_at", null: false
    t.string "mode", default: "managed", null: false
    t.bigint "organization_id", null: false
    t.string "provider", null: false
    t.jsonb "scopes", default: [], null: false
    t.datetime "updated_at", null: false
    t.index ["organization_id", "provider"], name: "index_org_integration_configs_on_organization_id_and_provider", unique: true
    t.index ["organization_id"], name: "index_org_integration_configs_on_organization_id"
  end

  create_table "organizations", force: :cascade do |t|
    t.text "company_summary"
    t.text "composio_api_key_encrypted"
    t.text "context_md"
    t.datetime "created_at", null: false
    t.bigint "default_slack_agent_id"
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
    t.index "lower((email_domain)::text)", name: "index_organizations_on_lower_email_domain_unique", unique: true, where: "((email_domain IS NOT NULL) AND ((email_domain)::text <> ''::text))"
    t.index ["default_slack_agent_id"], name: "index_organizations_on_default_slack_agent_id"
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
    t.bigint "created_by_user_id"
    t.string "description"
    t.string "icon"
    t.integer "install_count", default: 0, null: false
    t.string "name"
    t.bigint "organization_id"
    t.boolean "published", default: false, null: false
    t.jsonb "required_capabilities", default: [], null: false
    t.jsonb "required_integrations", default: [], null: false
    t.jsonb "requires_connections", default: []
    t.text "skill_md"
    t.string "slug"
    t.string "source", default: "built_in"
    t.string "source_url"
    t.text "system_prompt_fragment"
    t.datetime "updated_at", null: false
    t.integer "version", default: 1, null: false
    t.string "visibility", default: "private", null: false
    t.index ["organization_id"], name: "index_skill_definitions_on_organization_id"
    t.index ["published"], name: "index_skill_definitions_on_published"
    t.index ["slug"], name: "index_skill_definitions_on_slug", unique: true
    t.index ["source_url"], name: "index_skill_definitions_on_source_url"
    t.index ["visibility"], name: "index_skill_definitions_on_visibility"
  end

  create_table "skill_files", force: :cascade do |t|
    t.text "content"
    t.datetime "created_at", null: false
    t.string "file_type", default: "md", null: false
    t.string "path", null: false
    t.integer "position", default: 0, null: false
    t.bigint "skill_definition_id", null: false
    t.datetime "updated_at", null: false
    t.index ["skill_definition_id", "path"], name: "index_skill_files_unique_path", unique: true
    t.index ["skill_definition_id"], name: "index_skill_files_on_skill_definition_id"
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

  create_table "user_identities", force: :cascade do |t|
    t.string "channel", null: false
    t.datetime "created_at", null: false
    t.string "display_name"
    t.string "external_id", null: false
    t.bigint "organization_id", null: false
    t.datetime "updated_at", null: false
    t.bigint "user_id", null: false
    t.index ["organization_id", "channel", "external_id"], name: "index_user_identities_on_org_channel_external", unique: true
    t.index ["organization_id"], name: "index_user_identities_on_organization_id"
    t.index ["user_id", "channel"], name: "index_user_identities_on_user_id_and_channel"
    t.index ["user_id"], name: "index_user_identities_on_user_id"
  end

  create_table "users", force: :cascade do |t|
    t.datetime "created_at", null: false
    t.string "email", default: "", null: false
    t.string "encrypted_password", default: "", null: false
    t.string "name", null: false
    t.bigint "organization_id", null: false
    t.boolean "platform_admin", default: false, null: false
    t.datetime "remember_created_at"
    t.datetime "reset_password_sent_at"
    t.string "reset_password_token"
    t.string "role", default: "member", null: false
    t.jsonb "signup_utm", default: {}, null: false
    t.datetime "updated_at", null: false
    t.index ["email"], name: "index_users_on_email", unique: true
    t.index ["organization_id"], name: "index_users_on_organization_id"
    t.index ["platform_admin"], name: "index_users_on_platform_admin", where: "(platform_admin = true)"
    t.index ["reset_password_token"], name: "index_users_on_reset_password_token", unique: true
  end

  add_foreign_key "active_storage_attachments", "active_storage_blobs", column: "blob_id"
  add_foreign_key "active_storage_variant_records", "active_storage_blobs", column: "blob_id"
  add_foreign_key "agent_credential_grants", "agents"
  add_foreign_key "agent_credential_grants", "credentials"
  add_foreign_key "agent_files", "agents"
  add_foreign_key "agent_files", "organizations"
  add_foreign_key "agent_skills", "agents"
  add_foreign_key "agent_skills", "skill_definitions"
  add_foreign_key "agent_summaries", "agents"
  add_foreign_key "agent_summaries", "organizations"
  add_foreign_key "agent_template_versions", "agent_templates"
  add_foreign_key "agent_template_versions", "users", column: "created_by_user_id"
  add_foreign_key "agent_templates", "agent_template_versions", column: "current_version_id", on_delete: :nullify
  add_foreign_key "agent_templates", "organizations", validate: false
  add_foreign_key "agent_templates", "users", column: "created_by_user_id", validate: false
  add_foreign_key "agent_tool_policies", "agents"
  add_foreign_key "agent_tool_policies", "organizations"
  add_foreign_key "agent_webhooks", "agents"
  add_foreign_key "agent_webhooks", "organizations"
  add_foreign_key "agents", "agents", column: "manager_id"
  add_foreign_key "agents", "organizations"
  add_foreign_key "ai_configs", "agents"
  add_foreign_key "approval_rules", "agents"
  add_foreign_key "approval_rules", "organizations"
  add_foreign_key "audit_logs", "agents"
  add_foreign_key "audit_logs", "organizations"
  add_foreign_key "audit_logs", "tasks"
  add_foreign_key "audit_logs", "users", column: "acting_user_id", validate: false
  add_foreign_key "channel_configs", "agents"
  add_foreign_key "composio_toolkit_caches", "organizations"
  add_foreign_key "conversations", "agents"
  add_foreign_key "conversations", "conversations", column: "unified_conversation_id"
  add_foreign_key "conversations", "organizations"
  add_foreign_key "conversations", "users"
  add_foreign_key "credentials", "agents", on_delete: :cascade
  add_foreign_key "credentials", "organizations"
  add_foreign_key "credentials", "users", column: "created_by_user_id"
  add_foreign_key "email_events", "agents"
  add_foreign_key "email_events", "organizations"
  add_foreign_key "email_suppressions", "organizations"
  add_foreign_key "instances", "agents"
  add_foreign_key "integration_requests", "organizations"
  add_foreign_key "integration_requests", "users"
  add_foreign_key "integrations", "organizations"
  add_foreign_key "integrations", "users", column: "owner_user_id"
  add_foreign_key "invitations", "organizations"
  add_foreign_key "invitations", "users", column: "invited_by_id"
  add_foreign_key "mcp_servers", "agents"
  add_foreign_key "mcp_servers", "organizations"
  add_foreign_key "memberships", "organizations"
  add_foreign_key "memberships", "users"
  add_foreign_key "messages", "conversations"
  add_foreign_key "messages", "users", column: "sender_user_id", validate: false
  add_foreign_key "mobile_devices", "users"
  add_foreign_key "oauth_credentials", "organizations"
  add_foreign_key "org_integration_configs", "organizations"
  add_foreign_key "organizations", "agents", column: "default_slack_agent_id", on_delete: :nullify
  add_foreign_key "pending_approvals", "agents"
  add_foreign_key "pending_approvals", "messages", on_delete: :nullify
  add_foreign_key "pending_approvals", "organizations"
  add_foreign_key "pending_approvals", "users", column: "reviewed_by_id"
  add_foreign_key "scheduled_work", "agents"
  add_foreign_key "scheduled_work", "organizations"
  add_foreign_key "skill_definitions", "organizations", validate: false
  add_foreign_key "skill_definitions", "users", column: "created_by_user_id", validate: false
  add_foreign_key "skill_files", "skill_definitions"
  add_foreign_key "tasks", "agents"
  add_foreign_key "tasks", "agents", column: "assigned_by_agent_id"
  add_foreign_key "tasks", "conversations"
  add_foreign_key "tasks", "organizations"
  add_foreign_key "tasks", "tasks", column: "parent_task_id"
  add_foreign_key "tasks", "users", column: "assigned_by_user_id"
  add_foreign_key "user_identities", "organizations"
  add_foreign_key "user_identities", "users"
  add_foreign_key "users", "organizations"
end
