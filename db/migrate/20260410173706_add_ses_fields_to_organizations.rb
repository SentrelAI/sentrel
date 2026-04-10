class AddSesFieldsToOrganizations < ActiveRecord::Migration[8.1]
  def change
    add_column :organizations, :email_aws_region, :string, default: "us-east-1"
    add_column :organizations, :email_sns_topic_arn, :string
    add_column :organizations, :email_bounce_topic_arn, :string
    add_column :organizations, :email_complaint_topic_arn, :string
    # email_provider: "ses_managed" (we manage), "ses_byo" (their AWS), "shared_subdomain" (alchemy subdomain)
    add_column :organizations, :email_provider, :string, default: "ses_managed"
  end
end
