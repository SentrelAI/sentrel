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
end
