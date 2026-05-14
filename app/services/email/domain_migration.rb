module Email
  # When an org changes its email_domain, every existing email channel config
  # (sarah@old.com, alex@old.com, …) points at addresses that no longer route
  # to us. Two strategies:
  #   migrate    — rename the @localpart to the new domain so the agents keep
  #                working (most common case; in-flight threads break but
  #                future mail flows). EngineSync each affected agent.
  #   disconnect — drop the email ChannelConfig rows entirely; user re-adds
  #                them later. Cleaner state, more user effort.
  module DomainMigration
    module_function

    # Agents that own at least one email ChannelConfig on the given domain.
    # Returns [{ id:, name:, role:, address: }] for the UI preview modal.
    def impact_for(org, domain:)
      return [] if domain.blank?
      configs = org.agents.joins(:channel_configs).where(
        channel_configs: { channel_type: "email" }
      ).where("LOWER(channel_configs.config->>'address') LIKE ?", "%@#{domain.downcase}")
       .select("agents.id, agents.name, agents.role, channel_configs.config")
       .distinct
      configs.map do |a|
        { id: a.to_param, name: a.name, role: a.role, address: a.config["address"] }
      end
    end

    # Rename every email channel config from `<local>@from` to `<local>@to`.
    # Wakes every affected agent so its engine picks up the new identity.
    def migrate!(org, from:, to:)
      return 0 if from.blank? || to.blank? || from.casecmp(to).zero?
      affected_agent_ids = []

      ChannelConfig.transaction do
        configs = ChannelConfig
          .joins(:agent)
          .where(agents: { organization_id: org.id })
          .where(channel_type: "email")
          .where("LOWER(channel_configs.config->>'address') LIKE ?", "%@#{from.downcase}")

        configs.find_each do |cc|
          addr = cc.config["address"].to_s
          local, _at, _ = addr.rpartition("@")
          next if local.blank?
          new_addr = "#{local}@#{to}"
          cc.config = cc.config.merge("address" => new_addr)
          cc.save!
          affected_agent_ids << cc.agent_id
        end
      end

      affected_agent_ids.uniq.each do |aid|
        agent = Agent.find_by(id: aid)
        EngineSync.trigger(agent) if agent
      end

      affected_agent_ids.uniq.size
    end

    # Tear down every email channel for the org. EngineSync each so the
    # agents stop expecting inbound mail.
    def disconnect!(org)
      affected_agent_ids = []
      ChannelConfig.transaction do
        configs = ChannelConfig
          .joins(:agent)
          .where(agents: { organization_id: org.id })
          .where(channel_type: "email")
        affected_agent_ids = configs.pluck(:agent_id).uniq
        configs.destroy_all
      end

      affected_agent_ids.each do |aid|
        agent = Agent.find_by(id: aid)
        EngineSync.trigger(agent) if agent
      end

      affected_agent_ids.size
    end
  end
end
