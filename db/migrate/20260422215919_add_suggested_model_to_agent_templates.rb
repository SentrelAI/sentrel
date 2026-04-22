class AddSuggestedModelToAgentTemplates < ActiveRecord::Migration[8.0]
  def change
    add_column :agent_templates, :suggested_provider, :string, default: "anthropic", null: false
    add_column :agent_templates, :suggested_model,    :string
  end
end
