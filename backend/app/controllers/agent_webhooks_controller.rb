# Manage an agent's inbound webhook endpoints (the Webhooks tab on the
# agent page). The public receiver lives in HooksController.
class AgentWebhooksController < ApplicationController
  before_action :authenticate_user!
  before_action :set_agent

  def create
    webhook = @agent.agent_webhooks.create!(
      organization: current_tenant,
      name: params.require(:agent_webhook)[:name].to_s.strip,
      instruction: params.require(:agent_webhook)[:instruction].to_s.strip,
      source: params.require(:agent_webhook)[:source].presence || "generic",
    )
    render json: webhook_json(webhook), status: :created
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  def update
    webhook = @agent.agent_webhooks.find(params[:id])
    attrs = params.require(:agent_webhook).permit(:name, :instruction, :source, :active)
    webhook.update!(attrs)
    render json: webhook_json(webhook)
  rescue ActiveRecord::RecordInvalid => e
    render json: { error: e.message }, status: :unprocessable_entity
  end

  def destroy
    @agent.agent_webhooks.find(params[:id]).destroy!
    head :no_content
  end

  private

  def set_agent
    @agent = find_by_public_id!(current_tenant.agents, params[:agent_id])
  end

  def webhook_json(w)
    w.as_json(only: [ :id, :name, :instruction, :source, :active, :receive_count, :last_received_at, :created_at ])
     .merge(url: w.url(request.base_url))
  end
end
