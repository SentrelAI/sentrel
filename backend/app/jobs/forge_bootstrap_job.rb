# Runs a Forge::Bootstrap in the background so the admin UI doesn't
# block on a 5-minute job. Writes progress + summary into Rails.cache
# under the key Admin::ForgeController::PROGRESS_CACHE_KEY so the
# admin/forge page can poll for status.
class ForgeBootstrapJob < ApplicationJob
  queue_as :default

  def perform(brief_slugs:, concurrency: 20, prewarm_count: 50, resume: false)
    Forge::AnthropicClient.reset_usage!
    write_cache(status: "running", started_at: Time.current.iso8601,
                concurrency: concurrency, prewarm_count: prewarm_count,
                brief_count: brief_slugs.size)

    briefs = Forge::IdeaBank::ALL.select { |b| brief_slugs.include?(b[:slug]) }
    summary = Forge::Bootstrap.new(
      briefs: briefs, concurrency: concurrency,
      prewarm_count: prewarm_count, resume: resume,
    ).run

    write_cache(status: "done", finished_at: Time.current.iso8601,
                summary: summary_payload(summary))
  rescue => e
    write_cache(status: "errored", finished_at: Time.current.iso8601, error: e.message)
    raise
  end

  private

  def write_cache(payload)
    existing = Rails.cache.read(Admin::ForgeController::PROGRESS_CACHE_KEY) || {}
    Rails.cache.write(Admin::ForgeController::PROGRESS_CACHE_KEY,
                      existing.merge(payload.stringify_keys),
                      expires_in: 7.days)
  end

  def summary_payload(summary)
    usage = Forge::AnthropicClient.usage_total
    cost = ((usage[:input_tokens] * 3.0) + (usage[:output_tokens] * 15.0)) / 1_000_000.0
    {
      "skills_prewarmed" => summary.skills_prewarmed,
      "templates_total"  => summary.template_results.size,
      "templates_ok"     => summary.successes.size,
      "templates_failed" => summary.failures.size,
      "duration_s"       => summary.duration_s.round(1),
      "failures"         => summary.failures.first(20).map { |r| { slug: r.brief.is_a?(Hash) ? r.brief[:slug] : r.brief, error: r.error } },
      "usage"            => usage,
      "cost_estimate_usd" => cost.round(2),
    }
  end
end
