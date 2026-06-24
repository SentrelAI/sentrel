# Runs Forge::TemplatePreview in the background so the AI Template
# Creator UI doesn't sit on a synchronous request long enough for the
# proxy to 504. The page polls Admin::TemplatesController#preview_status
# every 2s via the cache token.
#
# Status states stored in Rails.cache under the token:
#   { status: "running", started_at: }
#   { status: "done",    finished_at:, preview: { ...serialized... } }
#   { status: "errored", finished_at:, error: "..." }
class TemplatePreviewJob < ApplicationJob
  queue_as :default

  CACHE_PREFIX = "template_preview:".freeze
  CACHE_TTL = 1.hour

  def perform(token:, brief:)
    write_state(token, status: "running", started_at: Time.current.iso8601)
    result = Forge::TemplatePreview.new(brief: brief.symbolize_keys).call

    if result.ok?
      payload = {
        template_attrs: result.template_attrs,
        requirements: result.requirements,
        resolved_skills: result.resolved_skills,
        unresolved_capabilities: result.unresolved_capabilities,
        lint: result.lint,
        duplicates: result.duplicates
      }
      write_state(token, status: "done", finished_at: Time.current.iso8601, preview: payload)
    else
      write_state(token, status: "errored", finished_at: Time.current.iso8601, error: result.error || "Unknown error")
    end
  rescue => e
    Rails.logger.error "[TemplatePreviewJob] #{token} crashed: #{e.class}: #{e.message}"
    write_state(token, status: "errored", finished_at: Time.current.iso8601, error: "#{e.class}: #{e.message}")
    raise
  end

  def self.cache_key(token)
    "#{CACHE_PREFIX}#{token}"
  end

  def self.fetch(token)
    Rails.cache.read(cache_key(token))
  end

  private

  def write_state(token, payload)
    Rails.cache.write(self.class.cache_key(token), payload.stringify_keys, expires_in: CACHE_TTL)
  end
end
