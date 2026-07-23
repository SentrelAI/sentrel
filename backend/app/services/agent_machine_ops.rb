require "net/http"

# Day-2 operations on an agent's Fly Machine. Wraps the Fly Machines API
# so the UI can offer "Restart / Reload / Redeploy / Logs / Destroy"
# buttons instead of making users shell out to flyctl.
#
# Every method returns a Hash with at least :ok (boolean) and :message
# so the controller can render status without re-interpreting API errors.
module AgentMachineOps
  module_function

  FLY_API = "https://api.machines.dev/v1".freeze

  # Restart the running Machine in place (keeps the volume, re-pulls env).
  def restart(agent)
    app = app_name(agent)
    mid = machine_id(agent) or return operation_failure(agent, :restart, "Agent has no machine_id recorded")
    fly_api(:post, "/apps/#{app}/machines/#{mid}/restart")
    clear_operation_failure(agent)
    { ok: true, message: "Restart requested" }
  rescue ApiNotFound
    recover_missing_machine(agent, operation: "restart", stale_machine_id: mid)
  rescue => e
    operation_exception(agent, :restart, e)
  end

  # Wake a stopped Fly Machine. Fly's auto_start_machines wakes on HTTP
  # traffic to the Machine's port — but our engine consumes Redis, not
  # HTTP, so the auto-start trigger never fires. We poke the Fly API
  # explicitly when an inbound message arrives for a cold agent.
  # Idempotent: hitting start on an already-running machine is a no-op.
  def start(agent)
    app = app_name(agent)
    mid = machine_id(agent) or return operation_failure(agent, :start, "Agent has no machine_id recorded")
    begin
      fly_api(:post, "/apps/#{app}/machines/#{mid}/start")
    rescue => e
      # Wakes race machine state transitions (412 failed_precondition, e.g.
      # "unable to start from 'created'" while an update/restart settles).
      # Read the actual state: already coming up → success; 'created' →
      # launch it via a config re-post; anything else → real failure.
      raise unless e.message.include?("412")
      m = fly_api(:get, "/apps/#{app}/machines/#{mid}")
      case m["state"]
      when "started", "starting", "replacing"
        # Already waking — the goal state is reached, nothing to do.
      when "created"
        fly_api(:post, "/apps/#{app}/machines/#{mid}", { config: m["config"], skip_launch: false })
      else
        raise
      end
    end
    clear_operation_failure(agent)
    { ok: true, message: "Start requested" }
  rescue ApiNotFound
    recover_missing_machine(agent, operation: "start", stale_machine_id: mid)
  rescue => e
    operation_exception(agent, :start, e)
  end

  # Tell the engine to reload its in-memory config AND push fresh env
  # vars into the Fly Machine (so rotated API keys, switched provider,
  # etc. actually apply). The Fly API replaces env
  # on machine update; the next boot reads the new values. Triggers a
  # Machine-level restart — no /data loss.
  def reload(agent)
    app = app_name(agent)
    mid = machine_id(agent) or return operation_failure(agent, :reload, "Agent has no machine_id recorded")

    current = fly_api(:get, "/apps/#{app}/machines/#{mid}")
    cfg = current["config"] || {}
    cfg["env"] = AgentProvisioner::FlyBackend.env_for(agent)
    begin
      fly_api(:post, "/apps/#{app}/machines/#{mid}", { config: cfg, skip_launch: false })
    rescue => e
      # Config updates race machine transitions the same way starts do —
      # one short settle + retry covers the common case (a brain switch
      # clicked while the machine is mid stop/start).
      raise unless e.message.include?("412")
      sleep 2
      fly_api(:post, "/apps/#{app}/machines/#{mid}", { config: cfg, skip_launch: false })
    end

    # Also fire the Redis sync so the engine rebuilds in-memory state
    # once it's back up (skills, channel pollers, etc.).
    EngineSync.trigger(agent)
    clear_operation_failure(agent)
    { ok: true, message: "Fresh env pushed + config reload requested" }
  rescue ApiNotFound
    recover_missing_machine(agent, operation: "reload", stale_machine_id: mid)
  rescue => e
    operation_exception(agent, :reload, e)
  end

  # Update the Machine's image reference to the latest tag AND refresh
  # env vars from the current Rails process env. Fly rolls the Machine.
  # Also pushes the current default guest sizing — so an agent created
  # before we bumped memory_mb / cpus picks up the new shape on the
  # next redeploy without a destroy + recreate cycle.
  def redeploy(agent, image: nil)
    app = app_name(agent)
    mid = machine_id(agent) or return operation_failure(agent, :redeploy, "Agent has no machine_id recorded")
    target = image.presence || EngineImage.current

    current = fly_api(:get, "/apps/#{app}/machines/#{mid}")
    cfg = current["config"] || {}
    cfg["image"] = target
    cfg["env"] = AgentProvisioner::FlyBackend.env_for(agent)
    # Apply current default sizing — keeps existing agents in sync with
    # whatever agent_provisioner.rb currently provisions for new ones.
    cfg["guest"] = { "cpus" => 2, "memory_mb" => 4096, "cpu_kind" => "shared" }
    # Scale-to-zero: adopt the clean-exit-stops policy on redeploy so
    # existing machines can sleep (see agent_provisioner).
    cfg["restart"] = { "policy" => "on-failure", "max_retries" => 3 }

    fly_api(:post, "/apps/#{app}/machines/#{mid}", { config: cfg, skip_launch: false })
    clear_operation_failure(agent)
    { ok: true, message: "Redeployed #{target} (2 CPU · 4 GB)" }
  rescue ApiNotFound
    recover_missing_machine(agent, operation: "redeploy", stale_machine_id: mid)
  rescue => e
    operation_exception(agent, :redeploy, e)
  end

  # Destroy + recreate the app and volume from scratch. Last resort when
  # a restart isn't enough (e.g. corrupt /data, wrong region, etc.).
  # Session transcripts and /data are LOST — warn the user client-side.
  def reprovision(agent)
    AgentProvisioner.terminate_for(agent)
    agent.instance&.destroy
    ProvisionAgentJob.perform_later(agent.id)
    clear_operation_failure(agent)
    { ok: true, message: "Tearing down and reprovisioning; give it ~60s" }
  rescue => e
    operation_exception(agent, :reprovision, e)
  end

  # Tail recent logs from Fly's log API. Returns an array of
  # { timestamp:, level:, message: } for the UI to render.
  def logs(agent, lines: 200)
    app = app_name(agent)
    query = URI.encode_www_form(count: lines)
    res = fly_api(:get, "/apps/#{app}/logs?#{query}")
    entries = Array(res["data"]).map do |row|
      attrs = row["attributes"] || {}
      {
        timestamp: attrs["timestamp"],
        level: attrs["level"],
        message: attrs["message"].to_s,
        instance: attrs["instance"]
      }
    end
    { ok: true, message: "ok", logs: entries }
  rescue => e
    Rails.logger.warn "AgentMachineOps.logs(agent=#{agent&.id}) failed: #{e.class}: #{e.message}"
    { ok: false, operation: "logs", message: e.message, error_class: e.class.name, logs: [] }
  end

  # ── internals ────────────────────────────────────────────────────────

  def app_name(agent)
    env = ENV.fetch("DEPLOY_ENV", Rails.env.production? ? "prod" : "dev")
    "alchemy-#{env}-agent-#{agent.id}"
  end

  def machine_id(agent)
    agent.instance&.machine_id.presence
  end

  def recover_missing_machine(agent, operation:, stale_machine_id:)
    instance = agent.instance
    unless instance
      ProvisionAgentJob.perform_later(agent.id)
      return { ok: true, message: "Fly machine was missing; provisioning a new machine" }
    end

    instance.update!(
      status: "provisioning",
      machine_id: nil,
      public_ip: nil,
      private_ip: nil,
      provisioning_error: "Fly machine #{stale_machine_id} was not found during #{operation}; recreating",
    )

    recreated = AgentProvisioner.provision_for(agent)
    if recreated&.machine_id.present?
      {
        ok: true,
        operation: operation.to_s,
        message: "Fly machine record was stale; recreated machine #{recreated.machine_id}"
      }
    else
      error = agent.reload.instance&.provisioning_error.presence || "unknown provisioning failure"
      {
        ok: false,
        operation: operation.to_s,
        message: "Fly machine record was stale, but recreation failed: #{error}"
      }
    end
  rescue => e
    operation_exception(agent, operation, e)
  end

  def operation_failure(agent, operation, message, error_class: nil)
    record_operation_failure(agent, operation, message)
    {
      ok: false,
      operation: operation.to_s,
      message: message,
      error_class: error_class
    }.compact
  end

  def operation_exception(agent, operation, error)
    Rails.logger.error "AgentMachineOps.#{operation}(agent=#{agent&.id}) failed: #{error.class}: #{error.message}\n#{error.backtrace&.first(5)&.join("\n")}"
    Sentry.capture_exception(error, extra: { agent_id: agent&.id, operation: operation }) if defined?(Sentry) && Sentry.respond_to?(:capture_exception)
    operation_failure(agent, operation, error.message, error_class: error.class.name)
  end

  def record_operation_failure(agent, operation, message)
    instance = agent&.instance
    return unless instance

    instance.update_columns(
      provisioning_error: "Ops #{operation} failed at #{Time.current.utc.iso8601}: #{message.to_s.truncate(500)}",
      updated_at: Time.current,
    )
  rescue => e
    Rails.logger.warn "AgentMachineOps: could not record #{operation} failure for agent=#{agent&.id}: #{e.message}"
  end

  def clear_operation_failure(agent)
    instance = agent&.instance
    return unless instance&.provisioning_error.to_s.start_with?("Ops ")

    instance.update_columns(provisioning_error: nil, updated_at: Time.current)
  end

  def fly_api(method, path, body = nil)
    token = ENV.fetch("FLY_API_TOKEN") { raise "FLY_API_TOKEN required" }
    uri = URI.parse("#{FLY_API}#{path}")
    req =
      case method
      when :get    then Net::HTTP::Get.new(uri)
      when :post   then Net::HTTP::Post.new(uri)
      when :delete then Net::HTTP::Delete.new(uri)
      end
    req["Authorization"] = "Bearer #{token}"
    req["Content-Type"] = "application/json"
    req.body = body.to_json if body
    res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: true, read_timeout: 30, open_timeout: 5) { |http| http.request(req) }
    raise ApiNotFound, "Fly #{method} #{path} → HTTP 404: #{res.body.to_s[0..300]}" if res.code == "404"
    raise "Fly #{method} #{path} → HTTP #{res.code}: #{res.body.to_s[0..300]}" unless res.is_a?(Net::HTTPSuccess)
    res.body.present? ? JSON.parse(res.body) : {}
  end

  class ApiNotFound < StandardError; end
end
