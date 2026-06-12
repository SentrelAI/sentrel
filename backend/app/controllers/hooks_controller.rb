# Public inbound webhook receiver: POST /hooks/:token
#
# The token IS the credential (32+ urlsafe chars, unguessable, revocable
# by deleting/regenerating the webhook). Any service that can POST JSON
# can wake the agent: Sentry alert rules, GitHub repo webhooks, Linear,
# Stripe, Zapier, curl.
#
# Dispatch path is the same Redis inbox every other inbound uses
# (AgentEventBus → engine BullMQ): the webhook's stored instruction +
# a summarized payload run as an immediate scheduled_task, and the
# agent's report lands in its web chat tab.
class HooksController < ApplicationController
  skip_before_action :verify_authenticity_token
  skip_before_action :set_tenant
  skip_before_action :authenticate_user!, raise: false

  MAX_BODY_BYTES = 256 * 1024
  PAYLOAD_EXCERPT_CHARS = 6_000

  def receive
    webhook = AgentWebhook.active.find_by(token: params[:token].to_s)
    # 404 (not 401/403) — don't confirm token existence to scanners.
    return head :not_found unless webhook

    raw = request.body.read(MAX_BODY_BYTES + 1).to_s
    return render json: { error: "payload too large (max #{MAX_BODY_BYTES} bytes)" }, status: :payload_too_large if raw.bytesize > MAX_BODY_BYTES

    payload = parse_payload(raw)
    delivery_id = delivery_id_for(webhook, raw)

    AgentEventBus.publish(
      type: "scheduled_task",
      agent: webhook.agent,
      channel: "web",
      payload: { instruction: compose_instruction(webhook, payload) },
      job_id: "webhook-#{webhook.id}-#{delivery_id}",
    )
    webhook.record_delivery!

    render json: { ok: true, delivery_id: delivery_id }, status: :accepted
  end

  private

  def parse_payload(raw)
    return {} if raw.blank?
    parsed = JSON.parse(raw) rescue nil
    return parsed if parsed.is_a?(Hash) || parsed.is_a?(Array)
    # Form-encoded or plain text — keep it usable instead of dropping it.
    request.POST.present? ? request.POST.to_unsafe_h : { "raw" => raw.truncate(2_000) }
  end

  # Provider delivery ids make retries idempotent (the engine inbox dedupes
  # on jobId). Fall back to a body hash so manual curl retries dedupe too.
  def delivery_id_for(_webhook, raw)
    request.headers["X-GitHub-Delivery"].presence ||
      request.headers["Sentry-Hook-Signature"].presence&.first(16) ||
      request.headers["Linear-Delivery"].presence ||
      Digest::SHA256.hexdigest(raw)[0, 16]
  end

  def compose_instruction(webhook, payload)
    event_hints = {
      "GitHub event" => request.headers["X-GitHub-Event"],
      "Sentry resource" => request.headers["Sentry-Hook-Resource"],
      "Linear event" => request.headers["Linear-Event"],
    }.compact_blank.map { |k, v| "#{k}: #{v}" }.join(" · ")

    json = JSON.pretty_generate(payload) rescue payload.to_s
    json = "#{json[0, PAYLOAD_EXCERPT_CHARS]}\n… (truncated)" if json.length > PAYLOAD_EXCERPT_CHARS

    <<~INSTRUCTION
      A webhook just fired: "#{webhook.name}" (source: #{webhook.source}#{event_hints.present? ? " · #{event_hints}" : ""}).

      #{webhook.instruction}

      ## Webhook payload
      ```json
      #{json}
      ```
    INSTRUCTION
  end
end
