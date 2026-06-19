# Rolls up token usage + cost from audit_logs for a single agent or for
# the whole org. Cheap queries thanks to indexes on (agent_id,
# created_at) and total_cost_usd.
module AgentSpend
  module_function

  # Returns a hash with { today:, seven_day:, thirty_day: } each shaped
  # { runs:, input_tokens:, output_tokens:, cache_read:, cache_written:,
  #   cost_usd:, top_models: [{ model_id:, runs:, cost_usd: }, ...] }
  def for_agent(agent)
    base = AuditLog.where(agent_id: agent.id)
    {
      today:      summarize(base.where(created_at: Time.current.utc.beginning_of_day..)),
      seven_day:  summarize(base.where(created_at: 7.days.ago..)),
      thirty_day: summarize(base.where(created_at: 30.days.ago..))
    }
  end

  def for_organization(org_id)
    base = AuditLog.where(organization_id: org_id)
    {
      today:      summarize(base.where(created_at: Time.current.utc.beginning_of_day..)),
      seven_day:  summarize(base.where(created_at: 7.days.ago..)),
      thirty_day: summarize(base.where(created_at: 30.days.ago..))
    }
  end

  def summarize(relation)
    agg = relation.pick(
      Arel.sql("COUNT(*)"),
      Arel.sql("COALESCE(SUM(input_tokens), 0)"),
      Arel.sql("COALESCE(SUM(output_tokens), 0)"),
      Arel.sql("COALESCE(SUM(cache_read_input_tokens), 0)"),
      Arel.sql("COALESCE(SUM(cache_creation_input_tokens), 0)"),
      Arel.sql("COALESCE(SUM(total_cost_usd), 0)"),
    ) || [ 0, 0, 0, 0, 0, 0.0 ]

    top_models = relation
      .group(:model_id)
      .order(Arel.sql("SUM(total_cost_usd) DESC NULLS LAST"))
      .limit(3)
      .pluck(:model_id, Arel.sql("COUNT(*)"), Arel.sql("COALESCE(SUM(total_cost_usd), 0)"))
      .map { |m, runs, cost| { model_id: m, runs: runs, cost_usd: cost.to_f.round(4) } }

    {
      runs:           agg[0],
      input_tokens:   agg[1],
      output_tokens:  agg[2],
      cache_read:     agg[3],
      cache_written:  agg[4],
      cost_usd:       agg[5].to_f.round(4),
      top_models:     top_models
    }
  end
end
