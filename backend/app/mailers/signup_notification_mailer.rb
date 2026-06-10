class SignupNotificationMailer < ApplicationMailer
  NOTIFY_TO = "elie@scribemd.ai".freeze

  def new_signup(user, source: "email")
    @user = user
    @organization = user.organization
    @source = source
    @signed_up_at = user.created_at

    mail(
      to: NOTIFY_TO,
      subject: "New signup: #{user.email}",
    )
  end
end
