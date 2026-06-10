# Deploy an agent-bundle/v1 (the open agent-spec folder format) as a
# live agent. Two sources:
#
#   POST /agent_bundles { github_url: "https://github.com/org/repo[/tree/ref[/subdir]]" }
#   POST /agent_bundles { bundle: <uploaded .tar.gz> }   ← what `npx agent-spec deploy` sends
#
# Validates against the spec (schema requireds, referenced files,
# secret-value scan), deploys via AgentBundles::Deployer, fires the
# same provisioning side effects as the create form, and lands on the
# new agent's page with a notice listing what's left to connect
# (integrations, secrets, pending channels).
class AgentBundlesController < ApplicationController
  before_action :authenticate_user!

  # GET /deploy-agent?source=<github-url>
  # The shareable "Deploy to double.md" wizard. With ?source= it fetches
  # the bundle and renders a full preview (persona, skills, knowledge,
  # channels, integrations, secrets) so the user sees exactly what
  # they're installing before clicking Deploy. Without ?source= it's an
  # empty form — paste a URL, Load, review, Deploy.
  def new
    source = params[:source].to_s.strip
    preview = nil
    error = nil

    if source.present?
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
      preview: preview,
      error: error,
    }
  end

  def create
    files =
      if params[:github_url].present?
        AgentBundles::Fetcher.from_github(params[:github_url])
      elsif params[:bundle].respond_to?(:read)
        AgentBundles::Fetcher.from_tarball(params[:bundle])
      else
        return redirect_back fallback_location: new_agent_path, alert: "Provide a GitHub URL or upload a bundle .tar.gz"
      end

    manifest = AgentBundles::Manifest.parse!(files)
    result = AgentBundles::Deployer.new(
      manifest: manifest,
      user: current_user,
      organization: current_tenant,
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
  rescue AgentBundles::FetchError, AgentBundles::InvalidBundle => e
    respond_to do |format|
      format.html { redirect_back fallback_location: new_agent_path, alert: "Bundle deploy failed: #{e.message}" }
      format.json { render json: { error: e.message }, status: :unprocessable_entity }
    end
  rescue ActiveRecord::RecordInvalid => e
    respond_to do |format|
      format.html { redirect_back fallback_location: new_agent_path, alert: "Bundle deploy failed: #{e.message}" }
      format.json { render json: { error: e.message }, status: :unprocessable_entity }
    end
  end

  private

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
      skills: manifest.skill_bundles.map { |b|
        {
          slug: b[:slug],
          file_count: b[:files].size,
          skill_md: b[:files]["SKILL.md"].to_s.truncate(2_000),
        }
      },
      knowledge: manifest.knowledge_docs.map { |d| { path: d[:path], why: d[:why], bytes: d[:content].to_s.bytesize } },
      channels: manifest.channels.map { |c| { type: c["type"], why: c["why"] } },
      integrations: manifest.integrations.map { |i|
        { service: i["service"] || i["name"], kind: i["type"] == "mcp" ? "mcp" : "composio", why: i["why"] }
      },
      secrets: manifest.secret_names,
      permissions: manifest.permissions,
    }
  end
end
