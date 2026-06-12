# Deploy an agent-bundle/v1 (the open agent-manifest folder format) as a
# live agent. Three sources:
#
#   POST /agent_bundles { github_url: "https://github.com/org/repo[/tree/ref[/subdir]]" }
#   POST /agent_bundles { bundle: <uploaded .tar.gz> }
#   POST /agent_bundles { upload_id: <token> }   ← wizard deploy of a CLI upload
#
# `npx agentmanifest deploy` is a two-step handshake: the CLI POSTs the
# packed folder to /agent_bundles/upload (unauthenticated — the CLI has
# no session), we validate + cache it and hand back a wizard URL
# (/deploy-agent?upload=<token>); the browser session then previews and
# deploys it like any other bundle.
#
# Either source plus agent_id REDEPLOYS: the updated bundle is applied
# to that existing agent (AgentBundles::Updater) instead of creating a
# new one.
#
# Validates against the spec (schema requireds, referenced files,
# secret-value scan), deploys via AgentBundles::Deployer, fires the
# same provisioning side effects as the create form, and lands on the
# new agent's page with a notice listing what's left to connect
# (integrations, secrets, pending channels).
class AgentBundlesController < ApplicationController
  before_action :authenticate_user!, except: :upload
  skip_before_action :verify_authenticity_token, only: :upload

  UPLOAD_TTL = 30.minutes

  # GET /deploy-agent?source=<github-url>
  # The shareable "Deploy to double.md" wizard. With ?source= it fetches
  # the bundle and renders a full preview (persona, skills, knowledge,
  # channels, integrations, secrets) so the user sees exactly what
  # they're installing before clicking Deploy. Without ?source= it's an
  # empty form — paste a URL, Load, review, Deploy.
  def new
    # Heal connection statuses before rendering — same debounced sync as
    # /integrations, so the wizard's Connected badges and required-gating
    # reflect Composio's live state, not a stale local snapshot.
    sync_key = "composio:sync:org_#{current_tenant.id}:user_#{current_user.id}"
    if ENV["COMPOSIO_API_KEY"].present? && Rails.cache.read(sync_key).blank?
      Rails.cache.write(sync_key, Time.current, expires_in: 60.seconds)
      ComposioConnectionSync.call(organization: current_tenant, user: current_user)
    end

    source = params[:source].to_s.strip
    upload_id = params[:upload].to_s.strip
    preview = nil
    error = nil

    if upload_id.present?
      # CLI upload handshake — the bundle was validated and cached by
      # #upload; expiry just means re-running `agentmanifest deploy`.
      files = Rails.cache.read(upload_cache_key(upload_id))
      if files
        begin
          preview = preview_payload(AgentBundles::Manifest.parse!(files))
        rescue AgentBundles::InvalidBundle => e
          error = e.message
        end
      else
        error = "Upload expired or not found — run `npx agentmanifest deploy` again."
      end
    elsif source.present?
      begin
        files = AgentBundles::Fetcher.from_github(source)
        manifest = AgentBundles::Manifest.parse!(files)
        preview = preview_payload(manifest)
      rescue AgentBundles::FetchError, AgentBundles::InvalidBundle => e
        error = e.message
      end
    end

    render inertia: "agent_bundles/new", props: {
      source: source,
      upload: upload_id.presence,
      preview: preview,
      error: error,
      # Existing agents so the wizard can offer "update an existing agent
      # from this bundle" (redeploy) instead of creating a new one.
      # ?agent_id= preselects update mode (deep-link from an agent page).
      agents: current_tenant.agents.order(:name).map { |a| { id: a.to_param, name: a.name, slug: a.slug } },
      agent_id: params[:agent_id].to_s.presence,
      # Org state so the wizard renders live status on the bundle's
      # requirements: which Composio services are already connected, and
      # which credential providers already have a stored secret.
      connected_services: current_tenant.integrations.where(status: "connected").pluck(:service_name).uniq,
      credential_providers: current_tenant.credentials.pluck(:provider).uniq,
      # Canonical platform skills the user can tick onto the agent at
      # deploy — these aren't in the bundle (bundles only ship custom
      # skills); they live on the platform and install by slug.
      platform_skills: SkillDefinition
        .where(slug: SkillDefinition.canonical_seed_slugs, published: true)
        .order(:category, :slug)
        .map { |s| { slug: s.slug, name: s.name, category: s.category, description: s.description.to_s.truncate(110), requires_connections: Array(s.requires_connections) } },
    }
  end

  # POST /agent_bundles/upload — the CLI half of `agentmanifest deploy`.
  # Accepts a multipart .tar.gz of the bundle folder, validates it against
  # the spec, and caches the file map under a random token for UPLOAD_TTL.
  # Unauthenticated by design: nothing org-scoped happens here, and the
  # token is only useful to someone who can sign in and click Deploy.
  def upload
    io = params[:bundle]
    return render json: { error: "missing multipart `bundle` file (.tar.gz)" }, status: :unprocessable_entity unless io.respond_to?(:read)
    if io.respond_to?(:size) && io.size > AgentBundles::Fetcher::MAX_BYTES
      return render json: { error: "bundle too large (>#{AgentBundles::Fetcher::MAX_BYTES / 1024 / 1024}MB compressed)" }, status: :unprocessable_entity
    end

    files = AgentBundles::Fetcher.from_tarball(io)
    manifest = AgentBundles::Manifest.parse!(files) # reject invalid bundles before caching

    token = SecureRandom.urlsafe_base64(24)
    Rails.cache.write(upload_cache_key(token), files, expires_in: UPLOAD_TTL)
    render json: {
      id: token,
      name: manifest.name,
      url: deploy_agent_url(upload: token),
      expires_in: UPLOAD_TTL.to_i,
    }, status: :created
  rescue AgentBundles::FetchError, AgentBundles::InvalidBundle => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  def create
    files =
      if params[:github_url].present?
        AgentBundles::Fetcher.from_github(params[:github_url])
      elsif params[:upload_id].present?
        Rails.cache.read(upload_cache_key(params[:upload_id])) ||
          raise(AgentBundles::FetchError, "upload expired — run `npx agentmanifest deploy` again")
      elsif params[:bundle].respond_to?(:read)
        AgentBundles::Fetcher.from_tarball(params[:bundle])
      else
        return redirect_back fallback_location: new_agent_path, alert: "Provide a GitHub URL or upload a bundle .tar.gz"
      end

    manifest = AgentBundles::Manifest.parse!(files)
    return redeploy(manifest) if params[:agent_id].present?

    result = AgentBundles::Deployer.new(
      manifest: manifest,
      user: current_user,
      organization: current_tenant,
      name: params[:agent_name],
      slug: params[:agent_slug],
      role: params[:agent_role],
      model: unsafe_hash(params[:model]),
      goal: unsafe_hash(params[:goal]),
      persona: unsafe_hash(params[:persona]),
      schedules: unsafe_array(params[:schedules]),
      platform_skill_slugs: params[:platform_skill_slugs],
      integration_choices: params[:integration_choices],
      inputs: unsafe_hash(params[:inputs]),
    ).call

    agent = result.agent
    EngineSync.trigger(agent)
    ProvisionAgentJob.perform_later(agent.id)

    # Also catalogue the bundle in the org's template library (versioned,
    # re-installable from /agent_templates) unless explicitly opted out.
    # Publisher → Exporter snapshots the just-deployed agent, so the
    # template carries the full persona + skill bundles + goal section.
    if params[:save_as_template] != "0"
      begin
        template = AgentTemplates::Publisher.new(
          agent: agent,
          user: current_user,
          name: "#{agent.name} (bundle)",
          category: "starter",
          description: manifest.description.presence || "Deployed from an agent-bundle/v1.",
          changelog: params[:github_url].present? ? "Deployed from #{params[:github_url]}" : "Deployed from uploaded bundle",
        ).call
        result.notices << "Saved to the template library as “#{template.name}”."
      rescue => e
        Rails.logger.warn "[AgentBundles] save_as_template failed: #{e.message}"
      end
    end

    msg = "#{agent.name} deployed from bundle — machine provisioning in background"
    msg += ". Next: #{result.notices.join(' · ')}" if result.notices.any?
    respond_to do |format|
      format.html { redirect_to agent_path(agent), notice: msg }
      format.json { render json: { agent_id: agent.to_param, url: agent_path(agent), notices: result.notices }, status: :created }
    end
  rescue ActiveRecord::RecordNotFound
    respond_to do |format|
      format.html { redirect_back fallback_location: new_agent_path, alert: "Agent not found — it may have been deleted." }
      format.json { render json: { error: "agent not found" }, status: :not_found }
    end
  rescue AgentBundles::FetchError, AgentBundles::InvalidBundle, ActiveRecord::RecordInvalid => e
    Rails.logger.warn "[AgentBundles#create] deploy failed: #{e.class}: #{e.message} (source=#{params[:github_url].presence || params[:upload_id].presence&.then { |id| "upload:#{id}" } || 'tarball'}) #{e.backtrace&.first}"
    respond_to do |format|
      format.html { redirect_back fallback_location: new_agent_path, alert: "Bundle deploy failed: #{e.message}" }
      format.json { render json: { error: e.message }, status: :unprocessable_entity }
    end
  rescue => e
    # Anything unexpected: log loudly, still land the user back on the
    # wizard with a real message instead of a 500 or a silent redirect.
    Rails.logger.error "[AgentBundles#create] unexpected error: #{e.class}: #{e.message}\n#{e.backtrace&.first(8)&.join("\n")}"
    respond_to do |format|
      format.html { redirect_back fallback_location: new_agent_path, alert: "Bundle deploy failed unexpectedly: #{e.message.truncate(200)}" }
      format.json { render json: { error: e.message }, status: :internal_server_error }
    end
  end

  private

  def upload_cache_key(token)
    "agent_bundles:upload:#{token.to_s.gsub(/[^A-Za-z0-9_-]/, '')}"
  end

  # Apply an updated bundle to an existing agent (the wizard's "update
  # existing agent" mode, or a JSON POST with agent_id). Spec-owned state
  # is replaced, operator-owned state kept — see AgentBundles::Updater.
  # No ProvisionAgentJob (the machine already exists) and no template
  # snapshot; EngineSync makes the running engine reload.
  def redeploy(manifest)
    agent = find_by_public_id!(current_tenant.agents, params[:agent_id])
    result = AgentBundles::Updater.new(
      manifest: manifest,
      agent: agent,
      user: current_user,
      organization: current_tenant,
      role: params[:agent_role],
      model: unsafe_hash(params[:model]),
      goal: unsafe_hash(params[:goal]),
      persona: unsafe_hash(params[:persona]),
      schedules: unsafe_array(params[:schedules]),
      platform_skill_slugs: params[:platform_skill_slugs],
      integration_choices: params[:integration_choices],
    ).call

    EngineSync.trigger(agent)

    msg = "#{agent.name} redeployed from bundle"
    msg += ". Next: #{result.notices.join(' · ')}" if result.notices.any?
    respond_to do |format|
      format.html { redirect_to agent_path(agent), notice: msg }
      format.json { render json: { agent_id: agent.to_param, url: agent_path(agent), notices: result.notices }, status: :ok }
    end
  end

  def unsafe_hash(p)
    return nil if p.blank?
    p.respond_to?(:to_unsafe_h) ? p.to_unsafe_h : p.to_h
  end

  # Inertia ships arrays of hashes as ActionController::Parameters; the
  # wizard's edited schedules need plain hashes for the Deployer. nil
  # when the param is absent (deploy not from the wizard) so the
  # Deployer falls back to the bundle's own schedules.
  def unsafe_array(p)
    return nil if p.nil?
    Array(p).map { |item| item.respond_to?(:to_unsafe_h) ? item.to_unsafe_h : item.to_h }
  end

  # Everything the wizard needs to show what a bundle will install.
  # Persona markdown ships in full (one bundle per page — payload is
  # fine); skill SKILL.md bodies are truncated for the accordion.
  def preview_payload(manifest)
    {
      name: manifest.name,
      role: manifest.role,
      description: manifest.description,
      goal: manifest.goal,
      model: manifest.model,
      persona: {
        identity_md: manifest.persona_md("identity"),
        personality_md: manifest.persona_md("personality"),
        instructions_md: manifest.persona_md("instructions"),
      },
      # Inbound webhook endpoints created at deploy (tokenized URLs land
      # on the agent's Webhooks tab).
      webhooks: manifest.webhooks.map { |w|
        { name: w["name"], source: w["source"].presence || "generic", instruction: w["instruction"], why: w["why"] }
      },
      # Deploy-time parameters — the wizard renders one form field per
      # input; values substitute {{key}} tokens at deploy.
      inputs: manifest.inputs.map { |i|
        {
          key: i["key"], label: i["label"], description: i["description"],
          placeholder: i["placeholder"], default: i["default"],
          required: i["required"] == true,
        }
      },
      skills: manifest.skill_bundles.map { |b|
        {
          slug: b[:slug],
          file_count: b[:files].size,
          skill_md: b[:files]["SKILL.md"].to_s.truncate(2_000),
        }
      },
      knowledge: manifest.knowledge_docs.map { |d| { path: d[:path], why: d[:why], bytes: d[:content].to_s.bytesize } },
      channels: manifest.channels.map { |c| { type: c["type"], why: c["why"] } },
      schedules: manifest.schedules.map { |s| { name: s["name"], cron: s["cron"], timezone: s["timezone"], why: s["why"], instruction: s["instruction"] } },
      integrations: manifest.integrations.map { |i|
        if i["any_of"].is_a?(Array)
          # Alternatives group — the agent needs ANY ONE of these
          # (e.g. a calendar: googlecalendar | outlook | calendly).
          # The wizard renders a picker with live connected-status.
          # required: blocks Deploy until the chosen one is connected.
          { kind: "choice", options: i["any_of"].map(&:to_s), required: i["required"] == true, why: i["why"] }
        else
          { service: i["service"] || i["name"], kind: i["type"] == "mcp" ? "mcp" : "composio", required: i["required"] == true, why: i["why"] }
        end
      },
      secrets: manifest.secret_names,
      permissions: manifest.permissions,
    }
  end
end
