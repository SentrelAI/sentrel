class AuditsController < ApplicationController
  before_action :authenticate_user!

  PAGE_SIZE = 100

  # GET /audits/approvals
  # GET /audits/approvals.csv
  # Filterable audit log of every approval decision — manual + auto-rule. The
  # CSV export is the compliance review surface; the HTML view is for
  # human spot-checks.
  def approvals
    scope = current_tenant.pending_approvals
              .includes(:agent, :reviewed_by)
              .order(created_at: :desc)

    scope = scope.where(agent_id: params[:agent_id]) if params[:agent_id].present?
    scope = scope.where(decision: params[:decision]) if params[:decision].present?
    scope = scope.where(status: params[:status]) if params[:status].present?
    scope = scope.where(payload_type: params[:payload_type]) if params[:payload_type].present?
    scope = scope.where("created_at >= ?", parse_time(params[:since])) if params[:since].present?
    scope = scope.where("created_at <= ?", parse_time(params[:until])) if params[:until].present?

    rows = scope.limit([params[:limit].to_i, 1000].min.then { |n| n <= 0 ? PAGE_SIZE : n }).to_a

    respond_to do |format|
      format.html do
        render inertia: "audits/approvals", props: {
          approvals: rows.map { |a| serialize(a) },
          agents: current_tenant.agents.select(:id, :name, :slug).as_json(only: [:id, :name, :slug]),
          filters: {
            agent_id: params[:agent_id],
            decision: params[:decision],
            status: params[:status],
            payload_type: params[:payload_type],
            since: params[:since],
            until: params[:until],
          },
        }
      end
      format.csv do
        send_data approvals_csv(rows),
          type: "text/csv",
          disposition: "attachment",
          filename: "approvals-#{Time.current.strftime("%Y%m%d-%H%M%S")}.csv"
      end
    end
  end

  private

  def serialize(a)
    {
      id: a.to_param,
      created_at: a.created_at,
      reviewed_at: a.reviewed_at,
      agent: a.agent&.as_json(only: [:id, :name, :slug, :role]),
      tool_name: a.tool_name,
      payload_type: a.payload_type,
      summary: a.summary,
      risk_tier: a.risk_tier,
      status: a.status,
      decision: a.decision,
      decision_text: a.decision_text,
      reviewed_by: a.reviewed_by&.as_json(only: [:id, :name, :email]),
      auto_rule_id: a.tool_input&.dig("_matched_rule_id"),
    }
  end

  def approvals_csv(rows)
    require "csv"
    CSV.generate do |csv|
      csv << %w[id created_at reviewed_at agent tool_name payload_type summary risk_tier status decision decision_text reviewed_by auto_rule_id]
      rows.each do |a|
        csv << [
          a.to_param,
          a.created_at&.iso8601,
          a.reviewed_at&.iso8601,
          a.agent&.name,
          a.tool_name,
          a.payload_type,
          a.summary,
          a.risk_tier,
          a.status,
          a.decision,
          a.decision_text,
          a.reviewed_by&.email,
          a.tool_input&.dig("_matched_rule_id"),
        ]
      end
    end
  end

  def parse_time(s)
    Time.parse(s.to_s)
  rescue ArgumentError, TypeError
    nil
  end
end
