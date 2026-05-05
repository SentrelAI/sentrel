# Delegation-tree observability. Where /ops/runs is a flat per-agent list of
# audit_log rows, /ops/traces collapses everything triggered by a single user
# request into one row that can be expanded to see the whole delegation tree.
#
# Definition of a "trace root": an audit_log whose action is inbound_message
# OR scheduled_task — i.e. work the user (or the cron) initiated. Every other
# run (task_assignment) is a child somewhere in a tree rooted at one of those.
#
# The tree is stitched together by:
#   1. tasks.parent_task_id — links a sub-task to the task that spawned it
#   2. tasks.assigned_by_agent_id — link from a task back to its assigner
#   3. audit_logs.task_id — links a run to the task it executed
#   4. audit_logs.conversation_id_ref — links runs in the same conversation
class Ops::TracesController < ApplicationController
  before_action :authenticate_user!

  PAGE_SIZE = 50

  # GET /ops/traces — list of trace roots with summary stats
  def index
    org_id = current_tenant.id

    roots_scope = AuditLog
                    .where(organization_id: org_id)
                    .where(action: %w[inbound_message scheduled_task])
                    .order(created_at: :desc)

    roots_scope = roots_scope.where(agent_id: params[:agent_id]) if params[:agent_id].present?
    roots_scope = roots_scope.where(status: params[:status]) if params[:status].present?
    roots_scope = roots_scope.where("created_at >= ?", params[:since]) if params[:since].present?

    limit = [params[:limit].to_i, 200].min
    limit = PAGE_SIZE if limit <= 0

    roots = roots_scope.includes(:agent).limit(limit).to_a
    descendants_by_root = compute_descendants_for_roots(roots, org_id)

    render inertia: "ops/traces/index", props: {
      traces: roots.map { |r| trace_summary(r, descendants_by_root[r.id] || []) },
      agents: current_tenant.agents.select(:id, :name, :slug).as_json(only: [:id, :name, :slug]),
      filters: {
        agent_id: params[:agent_id],
        status: params[:status],
      },
    }
  end

  # GET /ops/traces/:id — full tree for a single root
  def show
    root = find_by_public_id!(current_tenant.audit_logs, params[:id])
    descendants = compute_descendants_for_roots([root], current_tenant.id)[root.id] || []

    render inertia: "ops/traces/show", props: {
      trace: trace_detail(root, descendants),
    }
  end

  private

  # Walk forward from each root through:
  #   root run -> tasks where assigned_by_agent_id = root.agent_id AND created_at within window
  #   each task -> its child tasks (parent_task_id) BFS
  #   each task -> audit_logs with task_id = that task
  #
  # Limited to a 24h window per root to keep queries bounded.
  def compute_descendants_for_roots(roots, org_id)
    return {} if roots.empty?

    by_root = {}
    roots.each do |root|
      window_start = root.created_at
      window_end   = root.created_at + 24.hours
      seed_tasks = Task.where(organization_id: org_id)
                       .where("created_at BETWEEN ? AND ?", window_start, window_end)
                       .where(assigned_by_agent_id: root.agent_id)
                       .where(parent_task_id: nil)
                       .pluck(:id)

      all_task_ids = seed_tasks.dup
      frontier = seed_tasks
      depth = 0
      while frontier.any? && depth < 8
        children = Task.where(organization_id: org_id, parent_task_id: frontier).pluck(:id)
        break if children.empty?
        all_task_ids.concat(children)
        frontier = children
        depth += 1
      end

      runs = AuditLog
               .where(organization_id: org_id, task_id: all_task_ids)
               .where("created_at <= ?", window_end + 1.hour) # tolerate slight overrun
               .includes(:agent)
               .order(:created_at)
               .to_a
      by_root[root.id] = runs
    end
    by_root
  end

  def trace_summary(root, descendants)
    all_runs = [root] + descendants
    {
      id: root.id,
      created_at: root.created_at,
      root_run: run_row(root),
      descendant_count: descendants.size,
      agents_involved: all_runs.map(&:agent_id).uniq.size,
      total_cost_usd: all_runs.sum { |r| r.total_cost_usd.to_f }.round(4),
      total_duration_ms: all_runs.sum { |r| r.duration_ms.to_i },
      status: aggregate_status(all_runs),
      task_id: root.task_id,
    }
  end

  def trace_detail(root, descendants)
    trace_summary(root, descendants).merge(
      runs: ([root] + descendants).map { |r| run_row(r) },
      tree: build_tree(root, descendants),
    )
  end

  def build_tree(root, descendants)
    # Group runs by task. The root run has task_id=nil typically; descendants
    # are all keyed by task_id and we have parent_task_id on each task.
    task_ids = descendants.map(&:task_id).compact.uniq
    tasks_by_id = Task.where(id: task_ids).pluck(:id, :title, :status, :priority, :agent_id, :parent_task_id, :assigned_by_agent_id, :created_at)
                       .each_with_object({}) { |row, h| h[row[0]] = {
                         id: row[0], title: row[1], status: row[2], priority: row[3],
                         agent_id: row[4], parent_task_id: row[5], assigned_by_agent_id: row[6],
                         created_at: row[7],
                       } }
    runs_by_task = descendants.group_by(&:task_id)

    children_of = ->(parent_id) {
      tasks_by_id.values
                  .select { |t| t[:parent_task_id] == parent_id }
                  .sort_by { |t| t[:created_at] }
    }

    build_node = ->(task) {
      runs = (runs_by_task[task[:id]] || []).map { |r| run_row(r) }
      {
        task: task.except(:parent_task_id),
        runs: runs,
        children: children_of.call(task[:id]).map { |c| build_node.call(c) },
      }
    }

    {
      root_run: run_row(root),
      top_level_tasks: children_of.call(nil).map { |t| build_node.call(t) },
    }
  end

  def run_row(r)
    {
      id: r.id,
      created_at: r.created_at,
      agent: r.agent&.as_json(only: [:id, :name, :slug, :role]),
      action: r.action,
      status: r.status,
      duration_ms: r.duration_ms,
      total_cost_usd: r.total_cost_usd&.to_f,
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
      cache_read_input_tokens: r.cache_read_input_tokens,
      task_id: r.task_id,
      job_id: r.job_id,
      tool_call_count: r.output&.dig("tool_calls")&.length || 0,
      response_preview: r.output&.dig("response")&.to_s&.truncate(160),
    }
  end

  def aggregate_status(runs)
    return "running" if runs.empty?
    statuses = runs.map(&:status).uniq
    return "failed"  if statuses.include?("failed")
    return "success" if statuses.all? { |s| s == "success" }
    "mixed"
  end
end
