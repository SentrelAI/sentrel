module Email
  # Processes SES bounce SNS notifications.
  # Records EmailEvent and adds hard bounces to the suppression list.
  class BounceHandler
    def initialize(notification)
      @notification = notification
    end

    def call
      bounce = @notification["bounce"]
      return unless bounce

      org = find_org_by_source
      return unless org

      Array(bounce["bouncedRecipients"]).each do |recipient|
        addr = recipient["emailAddress"]&.downcase
        next unless addr

        EmailEvent.create!(
          organization: org,
          event_type: "bounce",
          recipient: addr,
          bounce_type: bounce["bounceType"],
          bounce_subtype: bounce["bounceSubType"],
          diagnostic: recipient["diagnosticCode"],
          raw: @notification,
        )

        if bounce["bounceType"] == "Permanent"
          EmailSuppression.find_or_create_by(
            organization: org,
            email_address: addr,
          ) { |s| s.reason = "hard_bounce" }
        end
      end
    end

    private

    def find_org_by_source
      source = @notification.dig("mail", "source")
      domain = source&.split("@")&.last
      Organization.find_by(email_domain: domain)
    end
  end
end
