class CredentialsController < ApplicationController
  before_action :authenticate_user!

  # GET /settings/credentials — full settings page (Inertia).
  def index
    # Preload grant counts in one query so the index doesn't N+1 across
    # credentials.
    grant_counts = AgentCredentialGrant
                     .where(credential_id: current_tenant.credentials.select(:id))
                     .group(:credential_id)
                     .count
    org_agent_count = current_tenant.agents.count

    creds = current_tenant.credentials
      .order(kind: :asc, provider: :asc, name: :asc)
      .map do |c|
        grants = grant_counts[c.id] || 0
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
          agent_grants_count: grants,
          # How many agents will be restarted if this credential is deleted.
          # If it has no explicit grants, it's the org-wide default for the
          # (kind, provider) pair and EngineSync hits every agent.
          dependent_agent_count: grants.positive? ? grants : org_agent_count,
          dependent_scope: grants.positive? ? "granted" : "org_default"
        }
      end

    render inertia: "settings/credentials", props: {
      credentials: creds,
      kinds: Credential::KINDS,
      providers: {
        llm_api_key:    Credential::LLM_PROVIDERS,
        cloud_provider: Credential::CLOUD_PROVIDERS,
        generic:        Credential::GENERIC_HINTS
      },
      # When an agent's propose_connection card sends the user here, we
      # ship the requested provider slug back to the page so the New
      # Credential modal can open pre-filled and the user doesn't have to
      # re-discover what they came here for.
      prefill_provider: params[:provider].to_s.presence,
      auto_open_new:    params[:open].to_s == "new",
      # Per-(kind, provider) field schema so the Add/Edit modal renders the
      # right form (Access Key ID + Secret for AWS, Account SID + Auth Token
      # for Twilio, single value for the rest). The frontend posts back a
      # `fields` hash whose keys match the schema entries.
      field_schemas: build_field_schemas,
      # Capability overview — for each capability we offer (image gen,
      # TTS, STT, browser, web search, doc parse, video gen, code sandbox)
      # show which provider keys are configured. The UI surfaces an "Add
      # key" CTA per missing provider so users see at-a-glance what's
      # active vs missing without having to remember the (kind, provider)
      # tuples themselves.
      capabilities: build_capabilities_overview
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

    # agent_id may arrive as a PrefixedIds string ("agt_…") or an integer.
    # Resolve + validate it belongs to this org. Nil/empty → org-scoped.
    attrs["agent_id"] = resolve_agent_id_for_cred(attrs["agent_id"])

    cred = current_tenant.credentials.new(attrs)
    cred.created_by_user_id = current_user.id
    cred.meta = sanitize_meta(meta_input)
    cred.fields = fields if fields.any?
    if cred.save
      record_audit!(cred, "credential_created")
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
    # agent_id can be moved between agents OR cleared back to org-scoped.
    attrs["agent_id"] = resolve_agent_id_for_cred(attrs["agent_id"]) if attrs.key?("agent_id")

    # Merge — rotating just one field shouldn't wipe the rest. Blank values
    # in the submitted hash are ignored (Credential#fields= drops them).
    cred.assign_attributes(attrs)
    cred.merge_fields!(new_fields) if new_fields.any?
    cred.meta = (cred.meta || {}).merge(sanitize_meta(meta_input)) if meta_input

    if cred.save
      # rotated_fields = which field keys were actually replaced (vs blank).
      record_audit!(cred, "credential_updated",
        extra: { rotated_fields: new_fields.keys })
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
    record_audit!(cred, "credential_destroyed",
      extra: { dependent_agent_ids: dependents.map(&:id) })
    cred.destroy!
    dependents.each { |a| EngineSync.trigger(a) rescue nil }
    redirect_to credentials_path, notice: "Credential removed"
  end

  private

  def credential_params
    params.require(:credential).permit(:kind, :provider, :name, :value, :agent_id, meta: {}, fields: {})
  end

  # Coerce an agent_id param into a real integer pointing to an agent
  # in the current org. Accepts the PrefixedIds slug ("agt_abc") or an
  # integer; returns nil for blank/empty input (= org-scoped credential).
  # Raises ActiveRecord::RecordNotFound if the agent doesn't belong to
  # the current org so we never silently leak a credential to a stranger.
  def resolve_agent_id_for_cred(raw)
    return nil if raw.blank?
    raw_s = raw.to_s
    agent = current_tenant.agents.find_by(slug: raw_s)
    agent ||= current_tenant.agents.find_by(id: Agent.find_by_prefix_id(raw_s)&.id)
    agent ||= current_tenant.agents.find_by(id: raw_s.to_i) if raw_s.match?(/\A\d+\z/)
    raise ActiveRecord::RecordNotFound, "agent #{raw_s} not in this org" unless agent
    agent.id
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

  # Per-capability provider preference list. Order is cost-cheapest-first
  # (matches the engine registries) so the UI can render them in priority
  # order. `kind` is the primary credential kind; `also` lists alternative
  # kinds (e.g. openai for image_gen reuses an existing llm_api_key row).
  CAPABILITY_PROVIDERS = {
    "image_generation" => {
      label: "Image generation",
      blurb: "Generate images from text via mcp__image__generate_image. Default to the first provider with a key.",
      providers: [
        { provider: "replicate", kind: "generic", also: [], label: "Replicate",        note: "flux-schnell ~$0.003/img — recommended" },
        { provider: "fal",       kind: "generic", also: [], label: "fal.ai",           note: "flux-schnell, similar pricing to Replicate" },
        { provider: "openai",    kind: "generic", also: [ "llm_api_key" ], label: "OpenAI gpt-image-1", note: "Reuses your OpenAI chat key. ~$0.04/img" },
        { provider: "google_ai", kind: "generic", also: [ "llm_api_key" ], label: "Google Imagen 3",    note: "Free tier on AI Studio." }
      ]
    },
    "tts" => {
      label: "Text to speech",
      blurb: "Voice-note replies via send_voice. Routed through the first provider with a key.",
      providers: [
        { provider: "elevenlabs", kind: "generic", also: [], label: "ElevenLabs",         note: "Best naturalness, $0.18/1K chars" },
        { provider: "openai",     kind: "generic", also: [ "llm_api_key" ], label: "OpenAI tts-1",   note: "Cheap, decent quality" },
        { provider: "google_ai",  kind: "generic", also: [ "llm_api_key" ], label: "Google Gemini",  note: "Free tier" },
        { provider: "deepgram",   kind: "generic", also: [], label: "Deepgram Aura",     note: "Fast, decent quality" }
      ]
    },
    "stt" => {
      label: "Speech to text",
      blurb: "Transcribes inbound voice notes from Telegram / WhatsApp before the agent sees them.",
      providers: [
        { provider: "groq",      kind: "generic", also: [ "llm_api_key" ], label: "Groq Whisper",  note: "~$0.04/hr — recommended" },
        { provider: "deepgram",  kind: "generic", also: [], label: "Deepgram Nova-2", note: "Best accuracy on noisy audio" },
        { provider: "openai",    kind: "generic", also: [ "llm_api_key" ], label: "OpenAI Whisper", note: "Reuses your OpenAI key" },
        { provider: "google_ai", kind: "generic", also: [ "llm_api_key" ], label: "Google Gemini",  note: "Free tier" }
      ]
    },
    "browser_access" => {
      label: "Stealth browser",
      blurb: "Camoufox sidecar handles this for free on every agent machine. Browserbase is a paid cloud fallback.",
      providers: [
        { provider: "camoufox",    kind: nil,       also: [], label: "Camoufox sidecar", note: "Built-in, no credential needed", always_available: true },
        { provider: "browserbase", kind: "generic", also: [], label: "Browserbase",      note: "Cloud fallback when the sidecar isn't running" }
      ]
    },
    "web_search" => {
      label: "Web search",
      blurb: "Managed search via mcp__search__web. Better than the SDK's built-in WebSearch for agent workflows.",
      providers: [
        { provider: "tavily",     kind: "generic", also: [], label: "Tavily",     note: "Free tier 1000 req/mo, recommended" },
        { provider: "exa",        kind: "generic", also: [], label: "EXA",        note: "Neural / semantic results" },
        { provider: "perplexity", kind: "generic", also: [], label: "Perplexity", note: "Answer-with-citations style" }
      ]
    },
    "doc_parse" => {
      label: "Document parsing",
      blurb: "Extract clean markdown from PDFs / docx / scanned images via mcp__doc__extract.",
      providers: [
        { provider: "llamaparse",  kind: "generic", also: [], label: "Llamaparse",  note: "1000 pages/day free tier, recommended" },
        { provider: "mistral_ocr", kind: "generic", also: [ "llm_api_key" ], label: "Mistral OCR", note: "Fast, multi-language" },
        { provider: "reducto",     kind: "generic", also: [], label: "Reducto",     note: "Table-heavy / financial docs" }
      ]
    },
    "video_generation" => {
      label: "Video generation",
      blurb: "5–10 second clips via mcp__video__generate.",
      providers: [
        { provider: "luma",      kind: "generic", also: [], label: "Luma Dream Machine", note: "Fastest cold-start, recommended" },
        { provider: "fal",       kind: "generic", also: [], label: "fal.ai (Wan/Hailuo)", note: "Many model options" },
        { provider: "runway",    kind: "generic", also: [], label: "Runway Gen-4",       note: "Highest quality, highest cost" },
        { provider: "google_ai", kind: "generic", also: [ "llm_api_key" ], label: "Google Veo 3", note: "Free tier on AI Studio" }
      ]
    },
    "code_sandbox" => {
      label: "Code execution sandbox",
      blurb: "Run model-generated Python / JS / bash in an isolated cloud sandbox via mcp__code__execute.",
      providers: [
        { provider: "e2b",   kind: "generic", also: [], label: "E2B",   note: "~100 hrs/mo free tier, recommended" },
        { provider: "modal", kind: "generic", also: [], label: "Modal", note: "For orgs already on Modal infra" }
      ]
    }
  }.freeze

  def build_capabilities_overview
    # One-pass index of (provider, kind) pairs we have a credential for.
    have = Set.new
    current_tenant.credentials.pluck(:kind, :provider).each { |k, p| have << "#{k}:#{p}" }

    CAPABILITY_PROVIDERS.map do |cap_key, cfg|
      providers = cfg[:providers].map do |p|
        has_key = if p[:always_available]
          true
        else
          kinds = [ p[:kind], *p[:also] ].compact
          kinds.any? { |k| have.include?("#{k}:#{p[:provider]}") }
        end
        {
          provider: p[:provider],
          label: p[:label],
          kind: p[:kind],
          note: p[:note],
          has_key: has_key,
          always_available: p[:always_available] == true
        }
      end
      {
        key: cap_key,
        label: cfg[:label],
        blurb: cfg[:blurb],
        providers: providers,
        active: providers.any? { |pp| pp[:has_key] }
      }
    end
  end

  # Audit log helper — matches the shape Admin::BaseController uses for
  # destroys so /audit_logs surfaces all secret-mutation events with the
  # same columns (acting_user_id + tool_name + input).
  def record_audit!(cred, action, extra: {})
    AuditLog.create!(
      organization_id: current_tenant.id,
      acting_user_id: current_user.id,
      action: action,
      tool_name: "credential",
      input: {
        credential_id: cred.id,
        kind: cred.kind,
        provider: cred.provider,
        name: cred.name,
        suffix: cred.display_suffix
      }.merge(extra).compact,
      status: "success",
    )
  rescue => e
    Rails.logger.error "[CredentialsController#audit] #{e.class}: #{e.message}"
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
