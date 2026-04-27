class AddAnalysisErrorToOrganizations < ActiveRecord::Migration[8.1]
  def change
    add_column :organizations, :website_analysis_error, :text
  end
end
