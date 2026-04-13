# Sprint 1c — Direct upload security
#
# By default, ActiveStorage::DirectUploadsController has NO authentication
# (anyone on the internet can create blob records) AND inherits the
# application's CSRF protection. Two problems:
#
# 1. No auth → DoS vector (unattached blobs accumulate before GC)
# 2. Inherited CSRF + Devise → handle_unverified_request resets the session
#    if a token mismatch happens, signing the user out and cascading errors
#
# The standard pattern is to require Devise auth on the endpoint and skip
# CSRF (session auth makes CSRF redundant for an idempotent endpoint).
Rails.application.config.to_prepare do
  ActiveStorage::DirectUploadsController.class_eval do
    before_action :authenticate_user!
    skip_before_action :verify_authenticity_token
  end
end
