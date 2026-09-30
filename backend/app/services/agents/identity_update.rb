module Agents
  # Applies an identity change an agent proposed in chat (the engine's
  # update_identity tool) once a teammate approves the before/after card.
  # The approval row is the audit record — who approved which change — and
  # persona prose edits also land in the agent's revision history.
  #
  # Refuses to apply over an edit made since the proposal: the card showed
  # the user a specific "before", and silently overwriting someone's newer
  # change with a stale proposal would lose it.
  module IdentityUpdate
    module_function

    FIELDS = %w[name role identity_md personality_md instructions_md].freeze

    class Stale < StandardError; end

    def apply!(approval, user:)
      changes = approval.tool_input.to_h["changes"].to_h.slice(*FIELDS)
      raise ArgumentError, "no identity changes in approval ##{approval.id}" if changes.empty?

      agent = approval.agent
      moved = changes.keys.reject { |f| agent[f].to_s.strip == changes[f]["before"].to_s.strip }
      raise Stale, "#{moved.join(', ')} changed since this was proposed" if moved.any?

      persona_before = agent.attributes.slice(*AgentPersonaRevision::FIELDS)
      agent.update!(changes.transform_values { |c| c["after"].to_s })
      agent.record_persona_revisions!(persona_before, user: user, note: "Changed from chat: #{approval.tool_input['why']}".first(500))
      EngineSync.trigger(agent)
      agent
    end
  end
end
