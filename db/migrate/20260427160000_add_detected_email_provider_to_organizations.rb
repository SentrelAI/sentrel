class AddDetectedEmailProviderToOrganizations < ActiveRecord::Migration[8.1]
  def change
    add_column :organizations, :detected_email_provider, :string
  end
end
