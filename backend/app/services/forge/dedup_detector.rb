module Forge
  # Heuristic near-duplicate detection for AgentTemplate rows.
  #
  # No embeddings; just three signals combined linearly:
  #   - Jaccard similarity on word 3-grams of identity_md (0..1)
  #   - 1 - normalized Levenshtein on name (0..1; 1 = identical names)
  #   - Jaccard on suggested_skill_slugs (0..1)
  #
  # Combined score = 0.5 * identity + 0.3 * name + 0.2 * skills.
  # Threshold 0.65 → "likely dup". Threshold is tuned to flag the
  # CSM/Account-Manager style overlap without flooding on every
  # vaguely-similar sales role.
  #
  # TemplatePack post-success uses this to LOG warnings (we never
  # auto-merge — the decision is always human). `rake forge:dedup`
  # scans everything and prints groups.
  class DedupDetector
    THRESHOLD = 0.65
    JACCARD_NGRAM = 3

    # Per-template: list of duplicates with scores + reason breakdown.
    Match = Struct.new(:other, :score, :identity_sim, :name_sim, :skills_sim, keyword_init: true)

    # Returns matches above THRESHOLD against any OTHER published template.
    # Excludes the row itself. Pulls only the columns we need to keep the
    # scan cheap when called from TemplatePack.
    def self.near_duplicates(template, candidates: nil)
      candidates ||= AgentTemplate.where(system_template: true)
                                  .where.not(id: template.id)
                                  .select(:id, :name, :slug, :identity_md, :suggested_skill_slugs)
      matches = []
      candidates.each do |other|
        m = compare(template, other)
        matches << m if m.score >= THRESHOLD
      end
      matches.sort_by { |m| -m.score }
    end

    # Returns all groups of near-dups across the entire catalog. Used by
    # `rake forge:dedup`. Each group is an array of templates that share
    # at least one above-threshold pairing.
    def self.find_groups(scope = AgentTemplate.where(system_template: true))
      rows = scope.select(:id, :name, :slug, :identity_md, :suggested_skill_slugs).to_a
      seen = Set.new
      groups = []
      rows.each do |row|
        next if seen.include?(row.id)
        group = [row]
        rows.each do |other|
          next if other.id == row.id || seen.include?(other.id)
          score = compare(row, other).score
          group << other if score >= THRESHOLD
        end
        if group.size > 1
          group.each { |t| seen << t.id }
          groups << group
        end
      end
      groups
    end

    # ── Internals ───────────────────────────────────────────────────────

    def self.compare(a, b)
      id_sim    = identity_jaccard(a.identity_md.to_s, b.identity_md.to_s)
      name_sim  = name_similarity(a.name.to_s, b.name.to_s)
      skill_sim = jaccard(Array(a.suggested_skill_slugs).to_set,
                          Array(b.suggested_skill_slugs).to_set)
      score = (0.5 * id_sim) + (0.3 * name_sim) + (0.2 * skill_sim)
      Match.new(other: b, score: score.round(3),
                identity_sim: id_sim.round(3),
                name_sim: name_sim.round(3),
                skills_sim: skill_sim.round(3))
    end

    def self.identity_jaccard(a, b)
      return 0.0 if a.empty? || b.empty?
      ng_a = ngrams(a, JACCARD_NGRAM)
      ng_b = ngrams(b, JACCARD_NGRAM)
      jaccard(ng_a, ng_b)
    end

    def self.ngrams(text, n)
      tokens = text.downcase.scan(/[a-z][a-z0-9]+/)
      return Set.new if tokens.size < n
      Set.new(tokens.each_cons(n).map { |w| w.join(" ") })
    end

    def self.jaccard(set_a, set_b)
      return 0.0 if set_a.empty? || set_b.empty?
      i = (set_a & set_b).size.to_f
      u = (set_a | set_b).size.to_f
      i / u
    end

    # Name similarity: 1 - normalized Levenshtein distance, with case +
    # punctuation stripped. "Customer Success Manager" vs "CSM" should
    # be high; "SDR" vs "Real Estate Agent" should be low.
    def self.name_similarity(a, b)
      na = a.downcase.gsub(/[^a-z0-9 ]/, " ").squeeze(" ").strip
      nb = b.downcase.gsub(/[^a-z0-9 ]/, " ").squeeze(" ").strip
      return 1.0 if na == nb
      return 0.0 if na.empty? || nb.empty?
      dist = levenshtein(na, nb).to_f
      max_len = [na.length, nb.length].max
      1.0 - (dist / max_len)
    end

    def self.levenshtein(s, t)
      # Standard DP; we expect short strings (≤80 chars) so O(s*t) is fine.
      m, n = s.length, t.length
      return n if m.zero?
      return m if n.zero?
      prev = (0..n).to_a
      curr = Array.new(n + 1, 0)
      (1..m).each do |i|
        curr[0] = i
        (1..n).each do |j|
          cost = s[i - 1] == t[j - 1] ? 0 : 1
          curr[j] = [
            curr[j - 1] + 1,    # insert
            prev[j] + 1,        # delete
            prev[j - 1] + cost  # substitute
          ].min
        end
        prev, curr = curr, prev
      end
      prev[n]
    end
  end
end
