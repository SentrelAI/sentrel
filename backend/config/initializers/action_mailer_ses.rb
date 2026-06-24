# Custom ActionMailer delivery method that sends transactional mail
# (invitations, signup notifications, weekly digests) through AWS SES,
# reusing the same Aws::SES::Client + credentials as the agent email
# channel (see app/services/email/outbound_sender.rb). This avoids adding
# the aws-sdk-rails gem — we already depend on aws-sdk-ses.
#
# Enabled per-environment via `config.action_mailer.delivery_method = :ses`.
# The From header on each message is used as the SES source, so that
# address (or its domain) must be a verified SES identity, and the account
# must be out of the SES sandbox to reach arbitrary recipients.
class SesDeliveryMethod
  def initialize(settings = {})
    @settings = settings
  end

  def deliver!(mail)
    client = Aws::SES::Client.new(region: ENV.fetch("AWS_REGION", "us-east-1"))
    # Pass destinations explicitly: the Mail gem strips BCC from raw output
    # (correct MIME behavior), so SES wouldn't otherwise see BCC recipients.
    client.send_raw_email(
      raw_message: { data: mail.to_s },
      destinations: mail.destinations,
    )
  end
end

ActiveSupport.on_load(:action_mailer) do
  ActionMailer::Base.add_delivery_method(:ses, SesDeliveryMethod)
end
