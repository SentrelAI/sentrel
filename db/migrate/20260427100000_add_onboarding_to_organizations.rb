class AddOnboardingToOrganizations < ActiveRecord::Migration[8.1]
  def change
    add_column :organizations, :website_url, :string
    add_column :organizations, :company_summary, :text
    add_column :organizations, :onboarding_completed_at, :datetime
  end
end
