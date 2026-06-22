# Serves the model picker catalog to the mobile app, parsed from the SAME
# source the web new-agent form uses (app/frontend/lib/model-catalog.ts), so
# the two never drift. The file ships in the production image (COPY . .), so
# this works in every environment; a tiny fallback covers the unexpected.
class Api::Mobile::ModelCatalogController < Api::Mobile::BaseController
  CATALOG_PATH = Rails.root.join("app", "frontend", "lib", "model-catalog.ts")

  def show
    providers = parse_catalog
    render json: { providers: providers.keys, models_by_provider: providers }
  end

  private

  def parse_catalog
    src = File.read(CATALOG_PATH)
    result = {}
    # Each "provider: [ … ]" block (anthropic, openrouter, …).
    src.scan(/(\w+):\s*\[(.*?)\]/m) do |key, body|
      models = []
      body.scan(/\{\s*value:\s*"([^"]*)",\s*label:\s*"([^"]*)"(?:\s*,\s*hint:\s*"([^"]*)")?\s*\}/m) do |value, label, hint|
        m = { value: value, label: label }
        m[:hint] = hint if hint.present?
        models << m
      end
      result[key] = models if models.any?
    end
    result.presence || FALLBACK
  rescue => e
    Rails.logger.warn("[ModelCatalog] parse failed: #{e.class}: #{e.message}")
    FALLBACK
  end

  FALLBACK = {
    "anthropic" => [
      { value: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", hint: "recommended default" },
      { value: "claude-opus-4-8", label: "Claude Opus 4.8", hint: "top reasoning" },
      { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", hint: "fast + cheap" },
    ],
  }.freeze
end
