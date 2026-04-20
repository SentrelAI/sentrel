class Ops::RunsController < ApplicationController
  before_action :authenticate_user!

  # GET /ops/runs
  # List recent agent runs with filters. This is the main observability page.
  def index
    scope = current_tenant.audit_logs
                          .where(action: %w[inbound_message heartbeat scheduled_task task_assignment])
                          .includes(:agent, :task)
                          .order(created_at: :desc)

    scope = scope.where(agent_id: params[:agent_id]) if params[:agent_id].present?
    scope = scope.where(status: params[:status]) if params[:status].present?
    scope = scope.where(action: params[:job_type]) if params[:job_type].present?
    scope = scope.where("duration_ms >= ?", params[:min_duration_ms].to_i) if params[:min_duration_ms].present?
    scope = scope.where("created_at >= ?", params[:since]) if params[:since].present?

    limit = [params[:limit].to_i, 200].min
    limit = 50 if limit <= 0
    runs = scope.limit(limit)

    # Totals for the filtered set (header stats)
    totals = {
      count: scope.count,
      total_cost_usd: scope.sum(:total_cost_usd).to_f.round(4),
      avg_duration_ms: scope.average(:duration_ms).to_i,
      failed_count: scope.where(status: "failed").count,
      cache_read_total: scope.sum(:cache_read_input_tokens).to_i,
      cache_create_total: scope.sum(:cache_creation_input_tokens).to_i,
    }

    render inertia: "ops/runs/index", props: {
      runs: runs.map { |r| run_summary(r) },
      totals: totals,
      agents: current_tenant.agents.select(:id, :name, :slug).as_json(only: [:id, :name, :slug]),
      filters: {
        agent_id: params[:agent_id],
        status: params[:status],
        job_type: params[:job_type],
        min_duration_ms: params[:min_duration_ms],
      },
    }
  end

  # GET /ops/runs/:id
  def show
    run = current_tenant.audit_logs.find(params[:id])

    render inertia: "ops/runs/show", props: {
      run: run_detail(run),
    }
  end

  private

  # Condensed row for the runs list
  def run_summary(r)
    {
      id: r.id,
      created_at: r.created_at,
      agent: r.agent&.as_json(only: [:id, :name, :slug]),
      action: r.action,
      status: r.status,
      duration_ms: r.duration_ms,
      total_cost_usd: r.total_cost_usd&.to_f,
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
      cache_read_input_tokens: r.cache_read_input_tokens,
      cache_creation_input_tokens: r.cache_creation_input_tokens,
      was_resume: r.was_resume,
      routed_toolkits: r.routed_toolkits,
      task_id: r.task_id,
      job_id: r.job_id,
      model_id: r.model_id,
      tool_call_count: r.output&.dig("tool_calls")&.length || 0,
    }
  end

  # Full detail with spans, prompt, response, tool calls
  def run_detail(r)
    run_summary(r).merge(
      prompt: r.input&.dig("prompt"),
      response: r.output&.dig("response"),
      tool_calls: r.output&.dig("tool_calls") || [],
      error: r.output&.dig("error"),
      session_id: r.output&.dig("session_id"),
      spans: r.spans || [],
      first_token_ms: r.first_token_ms,
      conversation_id: r.conversation_id_ref,
    )
  end
end
