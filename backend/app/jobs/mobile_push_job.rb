# Fans a single logical notification out to every Expo device belonging to the
# given users. Runs async (Sidekiq) so the triggering request — an engine event
# relay or a spend-cap check — never blocks on the exp.host round-trip.
class MobilePushJob < ApplicationJob
  queue_as :default

  # user_ids: Array<Integer>
  # title/body: strings shown in the OS notification
  # data: JSON-serializable hash delivered to the app (deep-link routing)
  def perform(user_ids:, title:, body:, data: {})
    tokens = MobileDevice.pushable.where(user_id: Array(user_ids).uniq).pluck(:expo_push_token).uniq
    return if tokens.empty?

    messages = tokens.map do |token|
      { to: token, title: title, body: body.to_s.truncate(180), data: data }
    end
    ExpoPush.send_messages(messages)
  end
end
