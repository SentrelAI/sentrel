# Keeps FLB Business-Integration System-User tokens alive. Meta's BISU tokens
# expire after ~60 days; refreshing (fb_exchange_token) only works while the
# current token is still valid — miss the window and the customer must
# re-consent. So: run daily, refresh anything expiring within the window.
#
# No-op unless META_FBL_ENABLED. Scoped to the meta_ads McpServer rows the FLB
# callback maintains (rows with no expires_at are token-paste system-user
# tokens, often non-expiring — left alone).
class MetaFblRefreshJob < ApplicationJob
  queue_as :default

  REFRESH_WINDOW = 21.days

  def perform
    return unless Meta::FacebookLogin.enabled?

    scope = McpServer.where(slug: MetaFblController::META_SLUG)
                     .where.not(expires_at: nil)
                     .where(expires_at: ..REFRESH_WINDOW.from_now)
    refreshed = 0
    scope.find_each do |server|
      fresh = Meta::FacebookLogin.refresh(server.access_token)
      server.update!(
        access_token: fresh[:access_token],
        expires_at:   fresh[:expires_in].present? ? Time.current + fresh[:expires_in].to_i.seconds : server.expires_at,
        status:       "connected",
      )
      refreshed += 1
    rescue => e
      # An expired/revoked token can't be refreshed — mark it so the
      # integration-health surface flags the org for a re-connect.
      Rails.logger.warn "MetaFblRefreshJob org=#{server.organization_id}: #{e.class}: #{e.message}"
      server.update_columns(status: "error") if server.expires_at&.past?
    end
    Rails.logger.info "MetaFblRefreshJob: refreshed #{refreshed} token(s)"
  end
end
