class CredentialsController < ApplicationController
  before_action :authenticate_user!

  # GET /settings/credentials — full settings page (Inertia).
  def index
    creds = current_tenant.credentials
      .order(kind: :asc, provider: :asc, name: :asc)
      .map do |c|
        {
          id: c.id,
          kind: c.kind,
          provider: c.provider,
          name: c.name,
          last_used_at: c.last_used_at,
          meta: c.meta,
          created_at: c.created_at,
          display_suffix: c.display_suffix,
          field_names: c.fields.keys,
          agent_grants_count: AgentCredentialGrant.where(credential_id: c.id).count,
        }
      end

    render inertia: "settings/credentials", props: {
      credentials: creds,
      kinds: Credential::KINDS,
      providers: {
        llm_api_key:    Credential::LLM_PROVIDERS,
        cloud_provider: Credential::CLOUD_PROVIDERS,
        generic:        Credential::GENERIC_HINTS,
      },
      # Per-(kind, provider) field schema so the Add/Edit modal renders the
      # right form (Access Key ID + Secret for AWS, Account SID + Auth Token
      # for Twilio, single value for the rest). The frontend posts back a
      # `fields` hash whose keys match the schema entries.
      field_schemas: build_field_schemas,
    }
  end

  def create
    attrs = credential_params.to_h
    fields = normalize_fields(attrs.delete("fields"))
    legacy_value = attrs.delete("value")
    meta_input = attrs.delete("meta") || {}
    # Tolerate the legacy single `value` param so older callers still work.
    if attrs["kind"].present? && attrs["provider"].present? && fields.empty? && legacy_value.present?
      schema = Credential.field_schema_for(attrs["kind"], attrs["provider"])
      primary = (schema.find { |f| f[:primary] } || schema.first)[:key]
      fields = { primary => legacy_value }
    end

    cred = current_tenant.credentials.new(attrs)
    cred.created_by_user_id = current_user.id
    cred.meta = sanitize_meta(meta_input)
    cred.fields = fields if fields.any?
    if cred.save
      retrigger_dependent_engine_syncs(cred)
      redirect_to credentials_path, notice: "#{cred.provider} credential “#{cred.name}” added"
    else
      redirect_back fallback_location: credentials_path, alert: cred.errors.full_messages.join(", ")
    end
  rescue StandardError => e
    Rails.logger.error "[CredentialsController#create] #{e.class}: #{e.message}\n#{e.backtrace.first(10).join("\n")}"
    redirect_back fallback_location: credentials_path,
      alert: "Couldn't save credential — #{e.class.name.demodulize}: #{e.message.truncate(200)}"
  end

  def update
    cred = current_tenant.credentials.find(params[:id])
    attrs = credential_params.to_h
    new_fields = normalize_fields(attrs.delete("fields"))
    legacy_value = attrs.delete("value")
    new_fields[cred.primary_field_name] ||= legacy_value if legacy_value.present?
    meta_input = attrs.delete("meta")

    # Merge — rotating just one field shouldn't wipe the rest. Blank values
    # in the submitted hash are ignored (Credential#fields= drops them).
    cred.assign_attributes(attrs)
    cred.merge_fields!(new_fields) if new_fields.any?
    cred.meta = (cred.meta || {}).merge(sanitize_meta(meta_input)) if meta_input

    if cred.save
      retrigger_dependent_engine_syncs(cred)
      redirect_to credentials_path, notice: "#{cred.provider} credential “#{cred.name}” updated"
    else
      redirect_back fallback_location: credentials_path, alert: cred.errors.full_messages.join(", ")
    end
  rescue StandardError => e
    Rails.logger.error "[CredentialsController#update] #{e.class}: #{e.message}\n#{e.backtrace.first(10).join("\n")}"
    redirect_back fallback_location: credentials_path,
      alert: "Couldn't update credential — #{e.class.name.demodulize}: #{e.message.truncate(200)}"
  end

  def destroy
    cred = current_tenant.credentials.find(params[:id])
    dependents = cred.agents.to_a
    cred.destroy!
    dependents.each { |a| EngineSync.trigger(a) rescue nil }
    redirect_to credentials_path, notice: "Credential removed"
  end

  private

  def credential_params
    params.require(:credential).permit(:kind, :provider, :name, :value, meta: {}, fields: {})
  end

  # Hash-ify whatever shape the fields param arrived as (Hash,
  # ActionController::Parameters, nil). String keys, string values, blanks
  # dropped. Defensive so any weird shape from the wire still reaches the
  # model as a clean Hash.
  def normalize_fields(raw)
    return {} if raw.blank?
    h = raw.respond_to?(:to_unsafe_h) ? raw.to_unsafe_h : raw.to_h rescue {}
    h.each_with_object({}) do |(k, v), acc|
      val = v.is_a?(String) ? v : v.to_s
      acc[k.to_s] = val unless val.strip.empty?
    end
  end

  # Only the explicit meta keys the UI sets are carried through. Anything
  # else the agent or a future feature dumps stays untouched (we merge into
  # the existing meta on update — never wipe it).
  ALLOWED_META_KEYS = %w[base_url usage_md requires_approval].freeze

  def sanitize_meta(raw)
    return {} if raw.blank?
    h = raw.respond_to?(:to_unsafe_h) ? raw.to_unsafe_h : raw.to_h rescue {}
    h.each_with_object({}) do |(k, v), acc|
      key = k.to_s
      next unless ALLOWED_META_KEYS.include?(key)
      if key == "requires_approval"
        acc[key] = ActiveModel::Type::Boolean.new.cast(v)
      else
        str = v.to_s.strip
        acc[key] = str unless str.empty?
      end
    end
  end

  # Flatten the schema constant into a key the frontend can look up via
  # `${kind}:${provider}` or `${kind}:*` as fallback.
  def build_field_schemas
    out = {}
    Credential::FIELD_SCHEMAS.each { |k, v| out[k] = v }
    out["__default__"] = Credential::DEFAULT_FIELDS
    out
  end

  # Triggers a config sync (env push + agent restart) for every agent that
  # either has an explicit grant for this credential OR — when there are no
  # grants — every agent in the org (because the credential is the new org
  # default for the (kind, provider) pair). Best-effort; logged on failure.
  def retrigger_dependent_engine_syncs(cred)
    targets = if cred.agents.exists?
      cred.agents.to_a
    else
      current_tenant.agents.to_a
    end
    targets.each do |a|
      EngineSync.trigger(a)
    rescue => e
      Rails.logger.warn "[CredentialsController] EngineSync.trigger(agent=#{a.id}) failed: #{e.message}"
    end
  end
end
