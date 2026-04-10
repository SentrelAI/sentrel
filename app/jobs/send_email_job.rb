class SendEmailJob < ApplicationJob
  queue_as :default

  # Don't retry permanent failures (invalid recipient, suppressed, domain not verified)
  discard_on Email::OutboundSender::PermanentFailure

  # Retry transient errors with exponential backoff (max 5 attempts)
  retry_on Aws::SES::Errors::Throttling, wait: :polynomially_longer, attempts: 5
  retry_on Aws::SES::Errors::ServiceUnavailable, wait: :polynomially_longer, attempts: 5
  retry_on Net::OpenTimeout, Net::ReadTimeout, wait: :polynomially_longer, attempts: 5

  def perform(payload)
    result = Email::OutboundSender.new(payload).call

    case result.status
    when :failed
      # Permanent failure — already logged, raise to discard
      raise Email::OutboundSender::PermanentFailure, result.error
    when :suppressed
      # Suppressed — already logged, just return (no retry, no failure)
      Rails.logger.info "Email suppressed for #{payload['to']}"
    end
  end
end
