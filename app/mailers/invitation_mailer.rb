class InvitationMailer < ApplicationMailer
  def invite(invitation)
    @invitation = invitation
    base = ENV.fetch("WEBHOOK_BASE_URL", "http://localhost:3000")
    @accept_url = invitation_link_url(
      invitation.token,
      host: base.sub(%r{^https?://}, ""),
      protocol: base.start_with?("https") ? "https" : "http",
    )
    mail(
      to: invitation.email,
      subject: "You're invited to join #{invitation.organization.name} on Alchemy",
    )
  end
end
