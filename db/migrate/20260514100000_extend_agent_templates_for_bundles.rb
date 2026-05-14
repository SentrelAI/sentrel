class ExtendAgentTemplatesForBundles < ActiveRecord::Migration[8.0]
  def change
    add_column :agent_templates, :email_signature_md,     :text
    add_column :agent_templates, :suggested_integrations, :jsonb, default: [], null: false
  end
end
