class CreateApprovalRules < ActiveRecord::Migration[8.1]
  # Standing-rules engine for the generic approval workflow. Lets owners say
  # "auto-approve any LinkedIn post under 3/day" or "auto-reject any spend
  # over $500" without the agent having to ask each time. The engine consults
  # this table inside request_approval *before* it pauses the turn — matching
  # rows resolve the promise immediately with their auto_decision.
  def change
    create_table :approval_rules do |t|
      t.references :organization, null: false, foreign_key: true
      # Nullable: org-wide rule when null, agent-specific otherwise.
      t.references :agent, null: true, foreign_key: true
      # `payload_type` filter — same enum as pending_approvals.payload_type.
      # Nullable means "any payload_type".
      t.string :payload_type
      # JSONB predicate matched against the request_approval payload.
      # Supported keys (all optional, AND-ed):
      #   { "field": "to", "match": "^@scribemd\\.ai$" }   — regex on string
      #   { "field": "amount_usd", "lte": 5 }              — numeric ≤
      #   { "field": "amount_usd", "gte": 500 }            — numeric ≥
      #   { "max_per_day": 3 }                              — daily count cap
      #   { "any_of": [<predicate>...] }                    — OR group
      # Empty {} matches everything.
      t.jsonb :predicate, null: false, default: {}
      # "approve" or "reject" — what to auto-resolve with on match.
      t.string :auto_decision, null: false
      # Free-text label so users can recognize rules in the audit UI.
      t.string :label
      # Convenience flag for fast disable without delete.
      t.boolean :enabled, null: false, default: true
      t.timestamps
    end
    add_index :approval_rules, [:organization_id, :enabled, :payload_type], name: "idx_approval_rules_lookup"
  end
end
