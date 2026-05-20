module Forge
  # Parallel fan-out over a list of briefs. Uses native threads because the
  # work is HTTP-bound (Claude API) — Ruby releases the GVL during net/http
  # reads so N=20 concurrent requests actually run concurrently.
  #
  # Usage:
  #   results = Forge::Orchestrator.run(
  #     briefs: Forge::RoleBriefs::BATCH_1,
  #     generator: Forge::TemplateGenerator,
  #     concurrency: 20
  #   )
  #   results.successes.size  # 10
  #   results.failures.map { |r| [r.brief[:slug], r.error] }
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

    def self.run(briefs:, generator:, concurrency: DEFAULT_CONCURRENCY, **opts)
      started = Time.current
      results = []
      mutex = Mutex.new
      queue = Queue.new
      briefs.each { |b| queue << b }
      queue.close

      threads = Array.new([concurrency, briefs.size].min) do
        Thread.new do
          while (brief = queue.pop)
            res = generator.new(brief: brief, **opts).call
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
  end
end
