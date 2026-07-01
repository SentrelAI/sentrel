# Provenance for bundle-derived (official) templates: where the agent.yaml
# bundle lives on GitHub + which ref it was imported at. NULL for user-saved /
# Forge-generated templates. Drives the "View on GitHub" link + repo-driven sync.
class AddSourceToAgentTemplates < ActiveRecord::Migration[8.1]
  def change
    add_column :agent_templates, :source_url, :string
    add_column :agent_templates, :source_ref, :string
  end
end
