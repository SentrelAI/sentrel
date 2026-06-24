class AddFeaturedToAgentTemplates < ActiveRecord::Migration[8.0]
  def change
    # Curated "Featured" agents surfaced in a highlight row at the top of the
    # public /templates gallery. featured_position orders them (NULLS sort
    # last); name breaks ties. Only publicly-visible templates should be
    # featured — admins promote a template to system before featuring it.
    add_column :agent_templates, :featured, :boolean, null: false, default: false
    add_column :agent_templates, :featured_position, :integer

    add_index :agent_templates, [ :featured, :featured_position ],
              where: "featured", name: "index_agent_templates_on_featured"
  end
end
