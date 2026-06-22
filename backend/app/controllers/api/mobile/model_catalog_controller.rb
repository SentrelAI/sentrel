# Serves the model picker to mobile, parsed from the SAME source the web
# agent model picker uses (app/frontend/components/agent-model-picker.tsx) so
# the lists never drift. That file groups models and tags each with its
# provider (Anthropic direct, OpenRouter specialty incl. Kimi/GLM, frontier,
# and a "Your Claude subscription" group shown only when the org has an
# Anthropic OAuth credential). The file ships in the prod image (COPY . .).
class Api::Mobile::ModelCatalogController < Api::Mobile::BaseController
  PICKER_PATH = Rails.root.join("app", "frontend", "components", "agent-model-picker.tsx")
  SUBSCRIPTION_GROUP = "Your Claude subscription".freeze

  def show
    groups = parse_groups
    # The subscription group (anthropic_account) is only valid when the org
    # has an Anthropic OAuth credential — otherwise picking it would 401.
    unless anthropic_account_connected?
      groups = groups.reject { |g| g[:group] == SUBSCRIPTION_GROUP }
    else
      # Surface it first, like the web does.
      sub, rest = groups.partition { |g| g[:group] == SUBSCRIPTION_GROUP }
      groups = sub + rest
    end

    render json: { groups: groups }
  end

  private

  def anthropic_account_connected?
    OauthCredential.exists?(organization_id: current_tenant.id, provider: "anthropic", kind: "ai_provider")
  rescue StandardError
    false
  end

  def parse_groups
    src = File.read(PICKER_PATH)
    groups = []
    # Each "group: "X", options: [ … ]" block (covers the MODELS const groups
    # plus the subscriptionGroup, which share this shape).
    src.scan(/group:\s*"([^"]*)",\s*options:\s*\[(.*?)\]/m) do |group_name, body|
      options = []
      body.scan(/\{\s*provider:\s*"([^"]*)",\s*model_id:\s*"([^"]*)",\s*label:\s*"([^"]*)"(?:\s*,\s*hint:\s*"([^"]*)")?\s*\}/m) do |provider, model_id, label, hint|
        o = { provider: provider, model_id: model_id, label: label }
        o[:hint] = hint if hint.present?
        options << o
      end
      groups << { group: group_name, options: options } if options.any?
    end
    groups.presence || FALLBACK
  rescue => e
    Rails.logger.warn("[ModelCatalog] parse failed: #{e.class}: #{e.message}")
    FALLBACK
  end

  FALLBACK = [
    {
      group: "Anthropic",
      options: [
        { provider: "anthropic", model_id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", hint: "recommended default" },
        { provider: "anthropic", model_id: "claude-opus-4-8", label: "Claude Opus 4.8", hint: "top reasoning" },
        { provider: "anthropic", model_id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", hint: "fast + cheap" },
      ],
    },
  ].freeze
end
