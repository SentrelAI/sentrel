require "timeout"

module Forge
  # Parallel fan-out over a list of briefs. Uses native threads because the
  # work is HTTP-bound (Claude API) — Ruby releases the GVL during net/http
  # reads so N=20 concurrent requests actually run concurrently.
  #
  # Per-job safety net:
  #   - Timeout.timeout(JOB_TIMEOUT) wraps each generator.call so a hung
  #     Claude request can't wedge a thread for the full 60s HTTP timeout.
  #   - One automatic retry on Timeout::Error or AnthropicClient::Error,
  #     with a short backoff before the second attempt.
  #   - After timeout-x2, the brief is recorded as a failure and the thread
  #     picks up the next one. Other threads stay productive.
  #
  # Usage:
  #   results = Forge::Orchestrator.run(
  #     briefs: Forge::RoleBriefs::BATCH_1,
  #     generator: Forge::TemplateGenerator,
  #     concurrency: 20
  #   )
  class Orchestrator
    Summary = Struct.new(:results, :duration_s, keyword_init: true) do
      def successes = results.select(&:ok?)
      def failures  = results.reject(&:ok?)
      def to_s
        "Forge: #{successes.size}/#{results.size} ok in #{duration_s.round(1)}s" +
          (failures.any? ? "\n  failures:\n    #{failures.map { |r| "#{r.brief[:slug] || r.brief[:name]}: #{r.error}" }.join("\n    ")}" : "")
      end
    end

    DEFAULT_CONCURRENCY = 20
    # Per-job ceiling. Templates needing many fresh skill generations
    # (analyzer → 10 SkillGenerator calls sequentially → template gen)
    # can take 100-180s legitimately when scraping/skills.sh misses and
    # everything falls through to Claude. 240s catches truly-hung calls
    # without falsely killing the slow-but-honest ones.
    JOB_TIMEOUT = 240
    RETRY_BACKOFF = 5

    def self.run(briefs:, generator:, concurrency: DEFAULT_CONCURRENCY, **opts)
      started = Time.current
      results = []
      mutex = Mutex.new
      queue = Queue.new
      briefs.each { |b| queue << b }
      queue.close

      threads = Array.new([ concurrency, briefs.size ].min) do
        Thread.new do
          while (brief = queue.pop)
            res = run_one(brief: brief, generator: generator, opts: opts)
            mutex.synchronize do
              results << res
              puts "[Forge] #{res.ok? ? '✓' : '✗'} #{res.brief[:slug] || res.brief[:name]}#{res.ok? ? '' : ": #{res.error}"}"
            end
          end
        end
      end
      threads.each(&:join)

      Summary.new(results: results, duration_s: Time.current - started)
    end

    # One brief, up to two attempts, each capped at JOB_TIMEOUT.
    def self.run_one(brief:, generator:, opts:)
      attempt = 0
      begin
        attempt += 1
        Timeout.timeout(JOB_TIMEOUT) do
          generator.new(brief: brief, **opts).call
        end
      rescue Timeout::Error => e
        if attempt < 2
          sleep RETRY_BACKOFF
          retry
        end
        synth_failure(brief, generator, "timed out after #{JOB_TIMEOUT}s (#{attempt} attempts)")
      rescue AnthropicClient::Error => e
        if attempt < 2
          sleep RETRY_BACKOFF
          retry
        end
        synth_failure(brief, generator, "anthropic error after #{attempt} attempts: #{e.message}")
      rescue => e
        # Non-retryable. Surface the error class so debugging is easier.
        synth_failure(brief, generator, "#{e.class}: #{e.message}")
      end
    end

    # Build a Result-shaped struct matching whatever the generator would
    # return. Both TemplateGenerator and SkillGenerator (and TemplatePack)
    # use a `Result` struct with at least `brief` and `error` fields and a
    # `#ok?` method, so this duck-types cleanly.
    def self.synth_failure(brief, generator, message)
      result_class = generator.const_get(:Result)
      result_class.new(brief: brief, error: message)
    end
  end
end
