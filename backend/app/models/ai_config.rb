class AiConfig < ApplicationRecord
  belongs_to :agent

  validates :provider, presence: true
  validates :model_id, presence: true

  # Fields that AgentProvisioner#env_for bakes into the Fly Machine env
  # (ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN, ANTHROPIC_DEFAULT_*_MODEL,
  # ENGINE_THINKING_LEVEL). Changing any of these requires a machine
  # reload — otherwise the engine keeps using the old provider config.
  # temperature / max_tokens aren't here because the engine reads them
  # from the agent row per job, not via env.
  ENV_AFFECTING_FIELDS = %w[provider model_id thinking_level].freeze
end
