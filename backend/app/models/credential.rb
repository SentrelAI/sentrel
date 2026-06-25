# Org-scoped secret store. Three flavours:
#
# - llm_api_key     — BYO LLM provider keys. Piped into the agent's Fly
#                     machine env (ANTHROPIC_API_KEY, OPENROUTER_API_KEY,
#                     etc.) by AgentProvisioner so the agent bills against
#                     the user's account.
# - cloud_provider  — AWS / Heroku / Hetzner / Vercel keys. Reachable from
#                     agent code via the secrets.get MCP tool.
# - generic         — any other API key (Stripe, Twilio, custom).
#
# A credential stores a Hash of fields (e.g. AWS = access_key_id +
# secret_access_key + region). Internally that hash is JSON-encoded into
# the encrypted value_ciphertext column. Single-field providers (LLM keys,
# DigitalOcean token, etc.) still expose a clean `.value` accessor that
# reads the canonical primary field.
class Credential < ApplicationRecord
  KINDS = %w[llm_api_key cloud_provider generic].freeze

  # Known providers per kind. Used by validation + the UI picker. The list
  # is intentionally open at the database layer (kind+provider+name is the
  # unique key, not a check constraint) — extend here as we add more.
  LLM_PROVIDERS    = %w[anthropic openai openrouter google_ai groq mistral together xai].freeze
  CLOUD_PROVIDERS  = %w[aws gcp azure heroku hetzner vercel digitalocean fly cloudflare].freeze
  GENERIC_HINTS    = %w[stripe twilio sendgrid mailgun resend slack notion github gitlab linear browserbase replicate fal google_ai elevenlabs deepgram tavily exa perplexity llamaparse reducto mistral_ocr luma runway e2b modal].freeze

  # Per-provider field schema. The UI uses this to render the right form
  # inputs; secrets.get returns the full fields map; AgentProvisioner reads
  # the `primary` (or "value") field for its env wiring.
  #
  # Each entry is { key:, label:, sensitive: true|false, optional: true|false,
  # multiline: true|false }. The first field is the canonical "value" for
  # single-value lookups; mark it explicitly with primary: true otherwise.
  DEFAULT_FIELDS = [ { key: "value", label: "Secret value", sensitive: true, primary: true } ].freeze

  FIELD_SCHEMAS = {
    # Single-value LLM keys. All providers use the same shape.
    "llm_api_key:*" => [
      { key: "value", label: "API key", sensitive: true, primary: true }
    ],

    # Cloud providers — varies wildly per service.
    "cloud_provider:aws" => [
      { key: "access_key_id",     label: "Access Key ID",       sensitive: true,  primary: true },
      { key: "secret_access_key", label: "Secret Access Key",   sensitive: true },
      { key: "region",            label: "Default Region",      optional: true }
    ],
    "cloud_provider:gcp" => [
      { key: "service_account_json", label: "Service Account JSON", sensitive: true, multiline: true, primary: true },
      { key: "project_id",           label: "Project ID",           optional: true }
    ],
    "cloud_provider:azure" => [
      { key: "client_id",       label: "Client ID",       sensitive: true, primary: true },
      { key: "client_secret",   label: "Client Secret",   sensitive: true },
      { key: "tenant_id",       label: "Tenant ID" },
      { key: "subscription_id", label: "Subscription ID", optional: true }
    ],
    "cloud_provider:heroku" => [
      { key: "api_key",       label: "API Key",       sensitive: true, primary: true },
      { key: "account_email", label: "Account Email", optional: true }
    ],
    "cloud_provider:hetzner" => [
      { key: "api_token",  label: "API Token",  sensitive: true, primary: true },
      { key: "project_id", label: "Project ID", optional: true }
    ],
    "cloud_provider:vercel" => [
      { key: "token",   label: "Personal Access Token", sensitive: true, primary: true },
      { key: "team_id", label: "Team ID",               optional: true }
    ],
    "cloud_provider:digitalocean" => [
      { key: "api_token", label: "API Token", sensitive: true, primary: true }
    ],
    "cloud_provider:fly" => [
      { key: "api_token", label: "API Token", sensitive: true, primary: true }
    ],
    "cloud_provider:cloudflare" => [
      { key: "api_token",  label: "API Token",  sensitive: true, primary: true },
      { key: "account_id", label: "Account ID", optional: true }
    ],

    # Generic — covers paired-key services like Stripe/Twilio.
    "generic:stripe" => [
      { key: "secret_key",      label: "Secret Key",            sensitive: true, primary: true },
      { key: "publishable_key", label: "Publishable Key",       optional: true },
      { key: "webhook_secret",  label: "Webhook Signing Secret", sensitive: true, optional: true }
    ],
    "generic:twilio" => [
      { key: "account_sid", label: "Account SID", primary: true },
      { key: "auth_token",  label: "Auth Token",  sensitive: true }
    ],
    "generic:sendgrid" => [
      { key: "api_key", label: "API Key", sensitive: true, primary: true }
    ],
    "generic:mailgun" => [
      { key: "api_key", label: "API Key", sensitive: true, primary: true },
      { key: "domain",  label: "Sending Domain", optional: true }
    ],
    "generic:github" => [
      { key: "token", label: "Personal Access Token", sensitive: true, primary: true }
    ],
    "generic:gitlab" => [
      { key: "token", label: "Personal Access Token", sensitive: true, primary: true }
    ],

    # Capability-provider keys: image_generation, tts, stt, browser_access.
    # The engine resolves these via secrets.get + the PLATFORM_*_KEY env
    # fallback. Each provider's "auto" mode walks the capability registry
    # in cost-cheapest order, so adding a key for any one provider here
    # enables the capability for the org without further wiring.
    "generic:browserbase" => [
      { key: "api_key",    label: "Browserbase API Key", sensitive: true, primary: true },
      { key: "project_id", label: "Project ID",          sensitive: false }
    ],
    "generic:replicate" => [
      { key: "api_key", label: "Replicate API Token (r8_…)", sensitive: true, primary: true }
    ],
    "generic:fal" => [
      { key: "api_key", label: "fal.ai API Key", sensitive: true, primary: true }
    ],
    "generic:google_ai" => [
      { key: "api_key", label: "Google AI Studio API Key", sensitive: true, primary: true }
    ],
    "generic:elevenlabs" => [
      { key: "api_key", label: "ElevenLabs API Key", sensitive: true, primary: true }
    ],
    "generic:deepgram" => [
      { key: "api_key", label: "Deepgram API Key", sensitive: true, primary: true }
    ],
    "generic:tavily" => [
      { key: "api_key", label: "Tavily API Key (tvly-…)", sensitive: true, primary: true }
    ],
    "generic:exa" => [
      { key: "api_key", label: "EXA API Key", sensitive: true, primary: true }
    ],
    "generic:perplexity" => [
      { key: "api_key", label: "Perplexity API Key (pplx-…)", sensitive: true, primary: true }
    ],
    "generic:llamaparse" => [
      { key: "api_key", label: "Llamaparse API Key (llx-…)", sensitive: true, primary: true }
    ],
    "generic:reducto" => [
      { key: "api_key", label: "Reducto API Key", sensitive: true, primary: true }
    ],
    "generic:mistral_ocr" => [
      { key: "api_key", label: "Mistral API Key", sensitive: true, primary: true }
    ],
    "generic:luma" => [
      { key: "api_key", label: "Luma API Key (luma-…)", sensitive: true, primary: true }
    ],
    "generic:runway" => [
      { key: "api_key", label: "Runway API Key", sensitive: true, primary: true }
    ],
    "generic:e2b" => [
      { key: "api_key", label: "E2B API Key", sensitive: true, primary: true }
    ],
    "generic:modal" => [
      { key: "token_id",     label: "Modal Token ID",     sensitive: true, primary: true },
      { key: "token_secret", label: "Modal Token Secret", sensitive: true }
    ]
  }.freeze

  acts_as_tenant :organization
  belongs_to :organization
  # When set, this credential is locked to a single agent — only that
  # agent's runs can read it via secrets.get. When nil, the credential
  # is org-scoped and AgentCredentialGrant rows gate visibility.
  belongs_to :agent, optional: true
  belongs_to :created_by_user, class_name: "User", optional: true
  has_many :agent_credential_grants, dependent: :destroy
  has_many :agents, through: :agent_credential_grants

  encrypts :value_ciphertext, deterministic: false

  validates :kind,     presence: true, inclusion: { in: KINDS }
  validates :provider, presence: true
  # Unique within (org, agent, provider). Two agents can each have their
  # own "Default openai key"; the org can also have its own. NULL agent_id
  # is treated as a distinct value here.
  validates :name,     presence: true, uniqueness: { scope: [ :organization_id, :agent_id, :provider ], case_sensitive: false }
  validate  :primary_field_present

  scope :org_scoped,    -> { where(agent_id: nil) }
  scope :agent_scoped,  ->(agent) { where(agent_id: agent.is_a?(Agent) ? agent.id : agent) }

  def self.field_schema_for(kind, provider)
    FIELD_SCHEMAS["#{kind}:#{provider}"] || FIELD_SCHEMAS["#{kind}:*"] || DEFAULT_FIELDS
  end

  def field_schema
    self.class.field_schema_for(kind, provider)
  end

  # Cleartext field hash, e.g. { "access_key_id" => "...", "secret_access_key" => "..." }.
  # Backwards-compatible: if value_ciphertext was set to a plain string
  # (pre-multi-field migration), it's surfaced under the schema's primary
  # field name so old single-value rows keep working.
  def fields
    raw = value_ciphertext
    return {} if raw.nil? || raw == ""
    parsed = JSON.parse(raw) rescue nil
    return parsed if parsed.is_a?(Hash)
    { primary_field_name => raw } # legacy single-string row
  end

  # Replaces all fields. Empty/blank values are dropped so the JSON stays tidy.
  # Accepts a plain Hash or an ActionController::Parameters — the controller
  # used to leave the latter wrapped, which then iterated weirdly.
  def fields=(hash)
    h = if hash.respond_to?(:to_unsafe_h)
          hash.to_unsafe_h
    elsif hash.respond_to?(:to_h)
          hash.to_h
    else
          hash || {}
    end
    cleaned = h.each_with_object({}) do |(k, v), acc|
      key = k.to_s
      val = v.is_a?(String) ? v : v.to_s
      acc[key] = val unless val.strip.empty?
    end
    self.value_ciphertext = cleaned.empty? ? nil : cleaned.to_json
  end

  # Merges new fields into the existing set — used by the update endpoint so
  # rotating one secret doesn't blank the others.
  def merge_fields!(hash)
    self.fields = fields.merge((hash || {}).transform_keys(&:to_s))
  end

  def primary_field_name
    schema = field_schema
    (schema.find { |f| f[:primary] } || schema.first)[:key]
  end

  # Canonical "the value" for single-value lookups. For multi-field credentials
  # this returns the primary field (e.g. AWS Access Key ID); use #fields to
  # get the full map.
  def value
    fields[primary_field_name]
  end

  def value=(val)
    self.fields = { primary_field_name => val.is_a?(String) ? val.strip : val }
  end

  # Resolves the credential an agent should use for a given (provider, kind).
  # Resolution order:
  #
  #   1. Agent-owned — a Credential row with agent_id = this agent. Locked
  #      to one agent; never visible to siblings in the same org.
  #   2. Per-agent grant — when the agent has any agent_credential_grants
  #      rows of this kind/provider, only those org credentials count.
  #   3. Org default — first org-scoped (agent_id IS NULL) credential of
  #      that kind+provider with no agent grants applying.
  #   4. Platform default — ENV["PLATFORM_#{PROVIDER}_KEY"] when set.
  #      Returned as a Credential::PlatformDefault stub.
  #
  # Tenant-safe: scoped to the agent's organization.
  def self.find_for(agent, provider:, kind:)
    return nil unless agent&.organization_id

    db_match = ActsAsTenant.with_tenant(agent.organization) do
      # 1. Agent-owned row wins.
      owned = where(agent_id: agent.id, provider: provider, kind: kind).order(:id).first
      next owned if owned

      # 2. Explicit grant on an org credential.
      granted = agent.credentials.where(provider: provider, kind: kind).order(:id).first
      next granted if granted

      # 3. Org default — only an org-scoped (agent_id IS NULL) credential counts.
      where(agent_id: nil, provider: provider, kind: kind).order(:id).first
    end
    return db_match if db_match

    PlatformDefault.from_env(provider: provider, kind: kind)
  end

  # Tier this credential occupies on its own. The secrets controller
  # refines this with grant-awareness ("agent_grant" vs raw "org_default").
  def source
    agent_id.present? ? "agent_owned" : "org_default"
  end

  # Quack-alike for Credential read paths when no DB row exists for a
  # provider/kind but ENV["PLATFORM_#{PROVIDER}_KEY"] does. Engine receives
  # the value identically; audit log + frontend can branch on `source`.
  class PlatformDefault
    attr_reader :provider, :kind

    def self.from_env(provider:, kind:)
      val = ENV["PLATFORM_#{provider.to_s.upcase}_KEY"].to_s
      return nil if val.strip.empty?
      new(provider: provider, kind: kind, value: val.strip)
    end

    def initialize(provider:, kind:, value:)
      @provider = provider.to_s
      @kind = kind.to_s
      @value = value
    end

    def id; nil; end
    def organization_id; nil; end
    def value; @value; end
    def fields; { "value" => @value }; end
    def name; "Sentrel platform default (#{provider})"; end
    def meta; {} ; end
    def source; "platform_default"; end
    def display_suffix
      @value.to_s.length > 4 ? @value[-4..] : "—"
    end
    # No-op: nothing to bump for a virtual credential.
    def use!; end
    def respond_to_missing?(name, *)
      %i[base_url usage_md].include?(name) || super
    end
  end

  # Mark this credential as "in use" so the UI can surface stale keys and
  # /settings/credentials can sort by recency.
  def use!
    update_column(:last_used_at, Time.current)
  end

  # Last 4 characters of the canonical primary value — used by the UI to
  # render a masked display ("sk-…AbCd") without ever shipping the full
  # secret. For multi-field creds we show the suffix of the primary field
  # so the user can still recognize the row.
  def display_suffix
    raw = value.to_s
    raw.length > 4 ? raw[-4..] : "—"
  end

  private

  def primary_field_present
    return if fields[primary_field_name].to_s.strip != ""
    errors.add(:base, "#{primary_field_name.humanize} is required")
  end
end
