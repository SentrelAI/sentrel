require "aws-sdk-sns"

module Email
  # Verifies SNS message signatures so attackers can't forge bounces or
  # inbound email notifications.
  module SnsVerifier
    module_function

    # Returns the parsed message hash if valid, nil if invalid.
    # Pass in the raw request body.
    def verify(raw_body)
      message_json = JSON.parse(raw_body)
      Aws::SNS::MessageVerifier.new.authenticate!(raw_body)
      message_json
    rescue Aws::SNS::MessageVerifier::VerificationError => e
      Rails.logger.warn "SNS signature invalid: #{e.message}"
      nil
    rescue JSON::ParserError => e
      Rails.logger.warn "SNS body not JSON: #{e.message}"
      nil
    end
  end
end
