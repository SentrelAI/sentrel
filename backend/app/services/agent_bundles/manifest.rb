require "yaml"

# Parses + validates an agent-bundle/v1 directory (the open spec from
# agent-spec/ — agent.yaml manifest + persona markdown + skills folders
# + knowledge docs). Operates on an in-memory file map so the same code
# handles a GitHub tarball, an uploaded archive, or a local directory:
#
#   files = { "agent.yaml" => "...", "identity.md" => "...",
#             "skills/apollo-enrichment/SKILL.md" => "...", ... }
#   manifest = AgentBundles::Manifest.parse!(files)
#
# Mirrors the checks in agent-spec/bin/validate.mjs: schema-level
# requireds, referenced-file existence, and the secret-value scan
# (bundles declare secret NAMES under secrets[], never values).
module AgentBundles
  class InvalidBundle < StandardError; end

  class Manifest
    SPEC = "agent-bundle/v1".freeze
    SECRET_KEY = /(token|secret|password|api[-_]?key|private[-_]?key)/i
    ALLOWED_HINTS = %w[address_hint name_hint].freeze

    attr_reader :data, :files

    def self.parse!(files)
      new(files).tap(&:validate!)
    end

    def initialize(files)
      @files = files
      raw = files["agent.yaml"]
      raise InvalidBundle, "agent.yaml not found at bundle root" if raw.blank?
      @data = YAML.safe_load(raw, permitted_classes: [], aliases: false)
      raise InvalidBundle, "agent.yaml is not a YAML mapping" unless @data.is_a?(Hash)
    rescue Psych::SyntaxError => e
      raise InvalidBundle, "agent.yaml: YAML parse error — #{e.message}"
    end

    def validate!
      raise InvalidBundle, "agent.yaml: spec must be #{SPEC.inspect} (got #{data['spec'].inspect})" unless data["spec"] == SPEC
      raise InvalidBundle, "agent.yaml: name is required" if data["name"].to_s.strip.empty?

      %w[identity personality instructions].each do |k|
        rel = data.dig("persona", k)
        next if rel.nil?
        raise InvalidBundle, "agent.yaml: persona.#{k} → #{rel} not found in bundle" unless file?(rel)
      end
      # Convention from the spec: personality.md is required even when the
      # persona block omits it.
      if data.dig("persona", "personality").nil? && !file?("personality.md")
        raise InvalidBundle, "bundle: personality.md missing (no persona.personality override given)"
      end

      Array(data["skills"]).each_with_index do |rel, i|
        raise InvalidBundle, "agent.yaml: skills[#{i}] → #{rel}/SKILL.md not found" unless file?(File.join(rel.to_s, "SKILL.md"))
      end
      Array(data["knowledge"]).each_with_index do |k, i|
        rel = k.is_a?(Hash) ? k["path"] : k
        raise InvalidBundle, "agent.yaml: knowledge[#{i}] → #{rel} not found" unless file?(rel.to_s)
      end

      scan_for_secret_values!(data.except("secrets"), "")
      true
    end

    def name            = data["name"].to_s
    def role            = data["role"].to_s
    def description     = data["description"].to_s
    def goal            = data["goal"].is_a?(Hash) ? data["goal"] : nil
    def model           = data["model"].is_a?(Hash) ? data["model"] : {}
    def channels        = Array(data["channels"]).select { |c| c.is_a?(Hash) && c["type"].present? }
    def permissions     = data["permissions"].is_a?(Hash) ? data["permissions"] : {}
    def secret_names    = Array(data["secrets"]).filter_map { |s| s.is_a?(Hash) ? s["name"] : s }.map(&:to_s)
    def integrations    = Array(data["integrations"]).select { |i| i.is_a?(Hash) }
    def schedules       = Array(data["schedules"]).select { |s| s.is_a?(Hash) && s["name"].present? && s["cron"].present? && s["instruction"].present? }
    # Deploy-time parameters ({{key}} substitution targets) — e.g. the
    # repo list a bug-fixer may work in. Rendered as wizard form fields.
    def inputs          = Array(data["inputs"]).select { |i| i.is_a?(Hash) && i["key"].present? && i["label"].present? }

    def persona_md(key)
      rel = data.dig("persona", key) || default_persona_path(key)
      rel && file?(rel) ? read(rel) : nil
    end

    # [{slug:, files: {"SKILL.md" => "...", "helpers/x.py" => "..."}}, ...]
    def skill_bundles
      Array(data["skills"]).map do |rel|
        dir = rel.to_s.sub(%r{\A\./}, "").chomp("/")
        slug = File.basename(dir)
        bundle_files = files.select { |p, _| p.start_with?("#{dir}/") }
                            .transform_keys { |p| p.delete_prefix("#{dir}/") }
        { slug: slug, files: bundle_files }
      end
    end

    # [{path:, content:, why:}, ...]
    def knowledge_docs
      Array(data["knowledge"]).filter_map do |k|
        rel = (k.is_a?(Hash) ? k["path"] : k).to_s
        next unless file?(rel)
        { path: File.basename(rel), content: read(rel), why: (k.is_a?(Hash) ? k["why"] : nil) }
      end
    end

    private

    def default_persona_path(key) = "#{key}.md"

    def normalize(rel) = rel.to_s.sub(%r{\A\./}, "")
    def file?(rel)     = files.key?(normalize(rel))
    def read(rel)      = files[normalize(rel)]

    def scan_for_secret_values!(node, path)
      case node
      when Hash
        node.each do |k, v|
          if SECRET_KEY.match?(k.to_s) && !ALLOWED_HINTS.include?(k.to_s) && v.is_a?(String)
            raise InvalidBundle, "agent.yaml: #{path}.#{k} looks like a secret VALUE — bundles may only declare secret names under secrets[]"
          end
          scan_for_secret_values!(v, "#{path}.#{k}")
        end
      when Array
        node.each_with_index { |v, i| scan_for_secret_values!(v, "#{path}[#{i}]") }
      end
    end
  end
end
