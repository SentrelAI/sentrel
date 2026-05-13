class Api::SecretsController < ApplicationController
  skip_before_action :verify_authenticity_token

  before_action :verify_engine_secret!

  # GET /api/secrets?agent_id=N&name=...&provider=...&kind=...
  # Engine asks for a credential value on behalf of the agent. The Rails
  # side enforces the ACL (Credential.find_for honors agent_credential_grants
  # before falling back to org defaults), bumps last_used_at, and writes
  # an audit log row per fetch so we can track which agent read which secret.
  #
  # Response:
  #   200 { value: "...", kind: "...", provider: "...", name: "..." }
  #   403 { error: "no access" }
  #   404 { error: "not found" }
  def show
    agent = Agent.find(params.require(:agent_id))

    name     = params[:name].to_s
    provider = params[:provider].to_s.presence
    kind     = params[:kind].to_s.presence || "cloud_provider"

    # When a name is given, look up unscoped within the org and then run the
    # ACL — so a credential the agent has no grant for returns 403, not 404
    # (the credential DOES exist, the agent just can't read it).
    cred =
      if name.present?
        Credential.where(organization_id: agent.organization_id, name: name).first
      elsif provider.present?
        Credential.find_for(agent, provider: provider, kind: kind)
      end

    return render(json: { error: "not found" }, status: :not_found) unless cred
    return render(json: { error: "no access" }, status: :forbidden) unless allowed?(agent, cred)

    cred.use!
    AuditLog.create!(
      organization_id: agent.organization_id,
      agent_id: agent.id,
      action: "secret_fetched",
      tool_name: "secrets.get",
      input: { credential_id: cred.id, name: cred.name, provider: cred.provider, kind: cred.kind },
      output: { suffix: cred.display_suffix, fields: cred.fields.keys },
      status: "success",
    )

    # Always return the full fields map — agents that only care about a
    # single canonical value can read `value` (the primary field). Multi-
    # field creds (AWS, Twilio, Stripe) get every component in `fields`.
    #
    # usage_md + base_url come from the credential's meta. They give the
    # agent just-in-time context about WHAT this credential is for and HOW
    # to use it — endpoint, auth header shape, slug rules, anything the
    # workspace owner pasted into the "Usage notes" textarea. Without this,
    # the agent gets a raw key and has no way to know it's an API token vs
    # a webhook secret vs something else.
    render json: {
      value:     cred.value,
      fields:    cred.fields,
      kind:      cred.kind,
      provider:  cred.provider,
      name:      cred.name,
      base_url:  cred.meta && cred.meta["base_url"].presence,
      usage_md:  cred.meta && cred.meta["usage_md"].presence,
      requires_approval: requires_approval?(cred),
    }
  rescue ActiveRecord::RecordNotFound
    render json: { error: "agent not found" }, status: :not_found
  end

  private

  # Credentials that can mutate paying infrastructure default to requiring
  # an explicit human ok before the engine hands the value to the model.
  # LLM keys are excluded (they're piped into env at boot, never fetched
  # at runtime). Generic creds default to no-gate unless meta opts in.
  HIGH_RISK_PROVIDERS = %w[aws gcp azure heroku hetzner vercel digitalocean fly cloudflare].freeze

  def requires_approval?(cred)
    explicit = cred.meta && cred.meta.key?("requires_approval") ? cred.meta["requires_approval"] : nil
    return explicit unless explicit.nil?
    return false if cred.kind == "llm_api_key"
    cred.kind == "cloud_provider" && HIGH_RISK_PROVIDERS.include?(cred.provider)
  end

  def allowed?(agent, cred)
    # Same-org rule — never cross-tenant.
    return false unless cred.organization_id == agent.organization_id
    # When the agent has any explicit grants, the credential must be in the
    # grant set. With no grants the agent uses org defaults (any credential
    # in the org).
    return true unless agent.agent_credential_grants.exists?
    agent.agent_credential_grants.where(credential_id: cred.id).exists?
  end

  def verify_engine_secret!
    expected = ENV["ENGINE_API_SECRET"].to_s
    given = request.headers["X-Engine-Secret"].to_s
    head :forbidden if expected.blank? || given != expected
  end
end
