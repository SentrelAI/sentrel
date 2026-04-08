class AddContextMdToOrganizations < ActiveRecord::Migration[8.1]
  def change
    add_column :organizations, :context_md, :text
  end
end
