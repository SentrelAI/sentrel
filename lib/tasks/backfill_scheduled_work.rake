namespace :backfill do
  desc "Step 5 — migrate scheduled_tasks to scheduled_work + create heartbeat rows."
  task scheduled_work: :environment do
    ActsAsTenant.without_tenant do
      # ── Migrate cron tasks ──
      cron_count = 0
      ScheduledTask.find_each do |st|
        next if ScheduledWork.exists?(organization_id: st.organization_id, agent_id: st.agent_id, mode: "cron", name: st.name)

        ScheduledWork.create!(
          organization: st.organization,
          agent: st.agent,
          mode: "cron",
          name: st.name,
          instruction: st.instruction,
          cron_expression: st.cron_expression,
          timezone: st.timezone || "UTC",
          active: st.active,
          last_run_at: st.last_run_at,
          next_run_at: st.next_run_at,
        )
        cron_count += 1
      end
      puts "Migrated #{cron_count} cron task(s) from scheduled_tasks."

      # ── Create heartbeat rows for agents that have heartbeat_enabled ──
      hb_count = 0
      Agent.where(heartbeat_enabled: true).find_each do |agent|
        next if ScheduledWork.exists?(agent_id: agent.id, mode: "interval", name: "Heartbeat")

        ScheduledWork.create!(
          organization: agent.organization,
          agent: agent,
          mode: "interval",
          name: "Heartbeat",
          instruction: "Heartbeat check — review any pending tasks and proactively check on items that need attention.",
          interval_seconds: (agent.heartbeat_interval_minutes || 30) * 60,
          active: true,
        )
        hb_count += 1
      end
      puts "Created #{hb_count} heartbeat row(s)."

      puts "Done."
    end
  end
end
