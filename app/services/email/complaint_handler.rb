module Email
  # Processes SES complaint SNS notifications (spam/abuse reports).
  # Records EmailEvent and adds complainants to the suppression list.
  class ComplaintHandler
    def initialize(notification)
      @notification = notification
    end

    def call
      complaint = @notification["complaint"]
      return unless complaint

      org = find_org_by_source
      return unless org

      Array(complaint["complainedRecipients"]).each do |recipient|
        addr = recipient["emailAddress"]&.downcase
        next unless addr

        EmailEvent.create!(
          organization: org,
          event_type: "complaint",
          recipient: addr,
          diagnostic: complaint["complaintFeedbackType"],
          raw: @notification,
        )

        EmailSuppression.find_or_create_by(
          organization: org,
          email_address: addr,
        ) { |s| s.reason = "complaint" }
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
