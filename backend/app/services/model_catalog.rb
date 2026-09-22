# Single source of truth for the model picker on web, mobile and Telegram.
#
# Rows come from catalog_models, synced daily from models.dev by
# ModelsDev::CatalogSync — so "what models exist" is data, not code. Groups
# surface the small `featured` set; `all` is every model we synced, which is
# what the web picker's search box filters over.
#
# Until the first sync lands (fresh DB, or models.dev down on boot day) we fall
# back to parsing the web picker component, which is where this list used to
# live — one deploy's worth of safety net, not a second source of truth.
module ModelCatalog
  PICKER_PATH = Rails.root.join("app", "frontend", "components", "agent-model-picker.tsx")
  SUBSCRIPTION_GROUP = "Your Claude subscription".freeze
  ANTHROPIC_GROUP = "Anthropic (direct)".freeze
  OPENROUTER_GROUP = "OpenRouter — recommended".freeze
  # Only used before the first sync lands; the live answer is default_model.
  FALLBACK_DEFAULT_MODEL = "claude-sonnet-5".freeze

  module_function

  # The model a new agent starts on: the newest Claude the daily sync has
  # featured (tool-calling, rolling alias, not an image model). Follows new
  # releases with no deploy. An admin can pin a different one by giving it a
  # lower `position`.
  def default_model
    CatalogModel.published.featured.where(provider: "anthropic").ordered.pick(:model_id) ||
      FALLBACK_DEFAULT_MODEL
  rescue StandardError => e
    Rails.logger.warn("[ModelCatalog] default_model failed: #{e.class}: #{e.message}")
    FALLBACK_DEFAULT_MODEL
  end

  # Grouped catalog. Drops the subscription group unless the org is connected;
  # surfaces it first when it is (mirrors the web picker).
  def groups(anthropic_account_connected: false)
    gs = synced_groups(anthropic_account_connected: anthropic_account_connected).presence ||
         parse_fallback
    if anthropic_account_connected
      sub, rest = gs.partition { |g| g[:group] == SUBSCRIPTION_GROUP }
      sub + rest
    else
      gs.reject { |g| g[:group] == SUBSCRIPTION_GROUP }
    end
  end

  # Flat, ordered list of every model in `groups` — { provider, model_id,
  # label, hint?, group }. Order is deterministic so an index into it is
  # stable (used as the Telegram inline-button callback payload).
  def flat(anthropic_account_connected: false)
    groups(anthropic_account_connected: anthropic_account_connected).flat_map do |g|
      g[:options].map { |o| o.merge(group: g[:group]) }
    end
  end

  # Every synced model, for the web picker's "search all models" surface.
  # Carries the extra columns that search shows — notably tool_call, because a
  # model that can't call tools can't drive an agent, and the UI says so rather
  # than silently hiding it.
  def all(anthropic_account_connected: false)
    rows = CatalogModel.published.ordered.map do |m|
      m.to_option.merge(
        context: m.context_limit,
        reasoning: m.reasoning,
        tool_call: m.tool_call,
        release_date: m.release_date&.iso8601
      )
    end
    return rows unless anthropic_account_connected
    # The subscription routes to Anthropic's own API, so it runs exactly the
    # Claude models — listed separately so picking one switches provider too.
    rows + rows.select { |r| r[:provider] == "anthropic" }
      .map { |r| r.merge(provider: "anthropic_account", hint: subscription_hint) }
  end

  def synced_groups(anthropic_account_connected: false)
    featured = CatalogModel.published.featured.ordered.to_a
    return [] if featured.empty?

    anthropic = featured.select { |m| m.provider == "anthropic" }
    openrouter = featured.select { |m| m.provider == "openrouter" }

    out = []
    if anthropic_account_connected && anthropic.any?
      out << {
        group: SUBSCRIPTION_GROUP,
        options: anthropic.map { |m|
          { provider: "anthropic_account", model_id: m.model_id, label: m.name, hint: subscription_hint }
        }
      }
    end
    out << { group: ANTHROPIC_GROUP, options: anthropic.map(&:to_option) } if anthropic.any?
    out << { group: OPENROUTER_GROUP, options: openrouter.map(&:to_option) } if openrouter.any?
    out
  end

  def subscription_hint
    "via your Pro/Max subscription"
  end

  # Pre-sync fallback: the hardcoded list still living in the picker component.
  def parse_fallback
    src = File.read(PICKER_PATH)
    out = []
    src.scan(/group:\s*"([^"]*)",\s*options:\s*\[(.*?)\]/m) do |group_name, body|
      options = []
      body.scan(/\{\s*provider:\s*"([^"]*)",\s*model_id:\s*"([^"]*)",\s*label:\s*"([^"]*)"(?:\s*,\s*hint:\s*"([^"]*)")?\s*\}/m) do |provider, model_id, label, hint|
        o = { provider: provider, model_id: model_id, label: label }
        o[:hint] = hint if hint.present?
        options << o
      end
      out << { group: group_name, options: options } if options.any?
    end
    out.presence || FALLBACK
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
        { provider: "anthropic", model_id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", hint: "fast + cheap" }
      ]
    }
  ].freeze
end
