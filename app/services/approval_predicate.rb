# Evaluates the JSONB `predicate` column on approval_rules against the
# `payload` of an in-flight request_approval call. Supports a small set of
# operators chosen to cover the common standing-rule cases without turning
# into a half-baked query language:
#
#   { "field": "to", "match": "^@scribemd\\.ai$" }   — regex on string field
#   { "field": "amount_usd", "lte": 5 }              — numeric ≤
#   { "field": "amount_usd", "gte": 500 }            — numeric ≥
#   { "field": "subject", "contains": "test" }       — case-insensitive substring
#   { "max_per_day": 3 }                             — daily count of approvals
#                                                      auto-approved by this rule
#                                                      (resets at UTC midnight)
#   { "any_of": [<predicate>, ...] }                 — OR group
#   { "all_of": [<predicate>, ...] }                 — AND group (default for the
#                                                      top level keys, but useful
#                                                      explicitly nested)
#
# Empty {} matches everything (use sparingly — that's auto-approve-all).
module ApprovalPredicate
  module_function

  def match?(predicate, payload, rule_id: nil)
    return true if predicate.blank?
    pred = predicate.is_a?(Hash) ? predicate.deep_symbolize_keys : {}
    eval_node(pred, payload || {}, rule_id)
  rescue StandardError => e
    Rails.logger.warn("ApprovalPredicate eval failed (rule=#{rule_id}): #{e.message}")
    false
  end

  def eval_node(node, payload, rule_id)
    return true if node.blank?

    if node[:any_of].is_a?(Array)
      return node[:any_of].any? { |sub| eval_node(sub.deep_symbolize_keys, payload, rule_id) }
    end
    if node[:all_of].is_a?(Array)
      return node[:all_of].all? { |sub| eval_node(sub.deep_symbolize_keys, payload, rule_id) }
    end

    # Atomic predicates — all keys present must match (AND semantics).
    if (cap = node[:max_per_day])
      return false unless rule_id
      today_count = PendingApproval
        .where("created_at >= ?", Time.current.utc.beginning_of_day)
        .where("decision IS NOT NULL")
        .where("(tool_input->>'_matched_rule_id') = ?", rule_id.to_s)
        .count
      return false if today_count >= cap.to_i
    end

    if node[:field].present?
      val = dig_payload(payload, node[:field].to_s)
      str = val.to_s
      if (m = node[:match])
        return false unless str.match?(Regexp.new(m, Regexp::IGNORECASE))
      end
      if (c = node[:contains])
        return false unless str.downcase.include?(c.to_s.downcase)
      end
      if (lte = node[:lte])
        return false unless val.respond_to?(:to_f) && val.to_f <= lte.to_f
      end
      if (gte = node[:gte])
        return false unless val.respond_to?(:to_f) && val.to_f >= gte.to_f
      end
      if (eq = node[:eq])
        return false unless str == eq.to_s
      end
    end

    true
  end

  # Dotted-path lookup: "items.0.to" walks an array.
  def dig_payload(payload, path)
    parts = path.split(".")
    parts.reduce(payload) do |acc, part|
      next nil unless acc
      if acc.is_a?(Array)
        idx = part.to_i
        acc[idx]
      elsif acc.is_a?(Hash)
        acc[part] || acc[part.to_sym]
      else
        nil
      end
    end
  end
end
