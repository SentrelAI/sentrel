module Nango
  # Proactive connection health: verify Nango-backed connections are still
  # valid (token not revoked, refresh working) BEFORE an agent hits a dead one.
  # Marks the Integration `status` so the UI shows "reconnect" and the engine's
  # connected-list reflects reality. The reactive half lives in Nango::Proxy
  # (a 401 mid-call flips status to "error" immediately).
  module Health
    module_function

    # Check one connection. Returns :ok | :error | :unknown.
    #   :ok      — Nango reports a healthy connection
    #   :error   — Nango reports errors, or the connection is gone (404)
    #   :unknown — byo_token / not checkable / transient lookup failure
    def check(integration)
      return :unknown if integration.byo_token? || integration.nango_connection_id.blank?
      conn = Nango::Client.get_connection(integration.nango_connection_id, integration.provider_config_key)
      errors = conn["errors"] || conn.dig("data", "errors") || conn.dig("connection", "errors") || []
      Array(errors).any? ? :error : :ok
    rescue Nango::Client::Error => e
      # A missing connection (404) is genuinely broken; anything else (5xx,
      # network) is transient — don't flip status on a flaky lookup.
      e.message.include?("404") ? :error : :unknown
    end

    # Sweep every connected/errored Nango integration, syncing status with
    # reality: mark newly-broken ones "error", heal recovered ones to
    # "connected". Returns a summary. Tenant-agnostic (runs across all orgs).
    def sweep
      checked = broken = healed = 0
      ActsAsTenant.without_tenant do
        Integration.nango_backed.where(status: %w[connected error]).find_each do |i|
          status = check(i)
          next if status == :unknown
          checked += 1
          if status == :error && i.status != "error"
            i.update_columns(status: "error", updated_at: Time.current)
            broken += 1
            sync_agents(i)
          elsif status == :ok && i.status != "connected"
            i.update_columns(status: "connected", updated_at: Time.current)
            healed += 1
            sync_agents(i)
          end
        end
      end
      { checked: checked, broken: broken, healed: healed }
    end

    # Wake the org's engines so their connected-list reflects the new status.
    def sync_agents(integration)
      Agent.where(organization_id: integration.organization_id).find_each do |a|
        EngineSync.trigger(a)
      rescue StandardError
        nil
      end
    end
  end
end
