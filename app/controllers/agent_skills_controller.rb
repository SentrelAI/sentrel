class AgentSkillsController < ApplicationController
  before_action :authenticate_user!
  before_action :set_agent

  # POST /agents/:agent_id/agent_skills
  def create
    skill_def = SkillDefinition.find(params[:skill_definition_id])
    agent_skill = @agent.agent_skills.find_or_create_by!(skill_definition: skill_def)
    agent_skill.update!(enabled: true)
    redirect_back fallback_location: agent_path(@agent), notice: "#{skill_def.name} installed"
  end

  # PATCH /agents/:agent_id/agent_skills/:id
  def update
    agent_skill = @agent.agent_skills.find(params[:id])
    agent_skill.update!(enabled: params[:enabled])
    redirect_back fallback_location: agent_path(@agent)
  end

  # DELETE /agents/:agent_id/agent_skills/:id
  def destroy
    agent_skill = @agent.agent_skills.find(params[:id])
    name = agent_skill.skill_definition.name
    agent_skill.destroy!
    redirect_back fallback_location: agent_path(@agent), notice: "#{name} removed"
  end

  private

  def set_agent
    @agent = current_tenant.agents.find(params[:agent_id])
  end
end
