# Per-agent ACL on third-party tool calls. One row per (agent, toolkit) —
# e.g. "Sam.gmail = read_write with GMAIL_DELETE_THREAD denied".
#
# Resolution rule (first match wins):
#   1. denied_tools includes the call → reject
#   2. preset == "full" → allow
#   3. allowed_tools non-empty → allow only listed
#   4. preset 'read_only' / 'read_write' → name-pattern match
#   5. preset 'custom' with empty allowed_tools → deny everything
#
# Defaults: when no policy row exists for a (agent, toolkit), the engine
# treats it as preset='read_write' (the historical behavior — every tool
# is callable). Adding a policy row tightens, never loosens.
class AgentToolPolicy < ApplicationRecord
  PRESETS = %w[read_only read_write full custom].freeze

  acts_as_tenant :organization
  belongs_to :organization
  belongs_to :agent

  validates :toolkit_slug, presence: true, uniqueness: { scope: :agent_id }
  validates :preset, inclusion: { in: PRESETS }

  # Decide whether `tool_name` (e.g. "GMAIL_SEND_EMAIL") is allowed under this
  # policy. Pure function — no DB calls.
  def allows?(tool_name)
    return false if denied_tools.include?(tool_name)
    return true  if preset == "full"
    return allowed_tools.include?(tool_name) if preset == "custom"
    allowed_tools.include?(tool_name) || matches_preset?(tool_name)
  end

  # For proxy-style tools (nango_request) there is no per-endpoint tool name to
  # pattern-match, so classify by HTTP verb instead: GET/HEAD/OPTIONS = read,
  # everything else = write. Mirrors the read_only/read_write/full presets.
  #   full / read_write → all methods
  #   read_only         → reads only
  #   custom            → reads only (custom can't express endpoints here)
  def allows_http_method?(method)
    read = %w[GET HEAD OPTIONS].include?(method.to_s.upcase)
    case preset
    when "full", "read_write" then true
    when "read_only", "custom" then read
    else read
    end
  end

  def matches_preset?(tool_name)
    case preset
    when "read_only"
      READ_ONLY_PATTERNS.any? { |p| tool_name.include?(p) }
    when "read_write"
      (READ_ONLY_PATTERNS + WRITE_PATTERNS).any? { |p| tool_name.include?(p) }
    else
      false
    end
  end

  READ_ONLY_PATTERNS = %w[_GET_ _LIST_ _FETCH_ _SEARCH_ _READ_ _VIEW_].freeze
  WRITE_PATTERNS     = %w[_CREATE_ _UPDATE_ _SEND_ _REPLY_ _ADD_ _APPEND_ _BATCH_UPDATE _POST_ _PUBLISH_].freeze
end
