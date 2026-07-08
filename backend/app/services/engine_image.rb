# The engine container image agents run on Fly. One place to resolve it, with
# guards against the failure we actually hit: ENGINE_IMAGE materialized from an
# empty/placeholder GitHub secret (e.g. "" or "-"), which ENV.fetch happily
# returns — Fly then 400s every provision/redeploy with
# "config.image: invalid image identifier".
#
# A value only counts if it looks like a real image reference (has a registry/
# repo path). Anything else falls back to the canonical image.
module EngineImage
  DEFAULT = "ghcr.io/sentrelai/sentrel-engine:latest".freeze

  module_function

  def current
    candidate = ENV["ENGINE_IMAGE"].to_s.strip
    return candidate if candidate.include?("/") && candidate.length > 3

    Rails.logger.warn "EngineImage: ENGINE_IMAGE=#{candidate.inspect} is not a valid image ref — using #{DEFAULT}" if candidate.present?
    DEFAULT
  end
end
