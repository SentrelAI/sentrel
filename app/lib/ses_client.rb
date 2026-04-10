module SesClient
  # Returns an SES client configured for the given organization.
  # Falls back to global env config if org has no specific region set.
  def self.for(org)
    region = org&.email_aws_region.presence || ENV.fetch("AWS_REGION", "us-east-1")
    Aws::SES::Client.new(region: region)
  end

  def self.sns_for(org)
    region = org&.email_aws_region.presence || ENV.fetch("AWS_REGION", "us-east-1")
    Aws::SNS::Client.new(region: region)
  end
end
