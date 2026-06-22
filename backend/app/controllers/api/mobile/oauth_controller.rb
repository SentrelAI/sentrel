# Kicks off Google sign-in for the mobile app. The Expo app opens
# `/api/mobile/oauth/google/start?redirect=<app-deep-link>` in an in-app
# browser (ASWebAuthenticationSession). We can't 302 straight into the
# omniauth request phase because omniauth-rails_csrf_protection requires a
# POST with a valid authenticity token — so we render a tiny auto-submitting
# form that POSTs into the SAME omniauth flow the web uses, tagging it
# `mobile=1` and carrying the app's redirect URL. The callback
# (Users::OmniauthCallbacksController#google_oauth2) reads those omniauth
# params and bounces back to the app with a freshly minted device token.
class Api::Mobile::OauthController < ApplicationController
  # This is a pre-auth, browser-rendered page; no mobile bearer token yet.
  def google_start
    redirect = params[:redirect].to_s
    unless Api::Mobile::OauthController.valid_mobile_redirect?(redirect)
      return render plain: "Invalid redirect target", status: :bad_request
    end

    token = form_authenticity_token
    html = <<~HTML
      <!doctype html>
      <html>
        <head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body style="background:#0B0B0F;color:#F5F5F7;font-family:-apple-system,system-ui,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
          <form id="f" action="/users/auth/google_oauth2" method="post">
            <input type="hidden" name="authenticity_token" value="#{ERB::Util.html_escape(token)}">
            <input type="hidden" name="mobile" value="1">
            <input type="hidden" name="redirect" value="#{ERB::Util.html_escape(redirect)}">
            <noscript><button type="submit">Continue with Google</button></noscript>
          </form>
          <p>Redirecting to Google…</p>
          <script>document.getElementById('f').submit();</script>
        </body>
      </html>
    HTML
    render html: html.html_safe, layout: false
  end

  # Only allow bouncing back into the app's own schemes — never an arbitrary
  # host. `exp://` covers Expo Go (dev), `sentrel://` the standalone build.
  def self.valid_mobile_redirect?(url)
    url.present? && (url.start_with?("exp://", "sentrel://", "exp+sentrel://"))
  end
end
