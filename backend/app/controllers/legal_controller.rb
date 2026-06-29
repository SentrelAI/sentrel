# Public legal pages — Privacy Policy, Terms of Service, and Data Deletion
# instructions. Required for Meta App Review (Facebook Login / Marketing API
# verification needs a public Privacy Policy URL, Terms URL, and a Data Deletion
# Instructions URL). No auth — these must be reachable by anyone, incl. Meta's
# reviewers.
class LegalController < ApplicationController
  LAST_UPDATED = "June 29, 2026".freeze

  def privacy
    render inertia: "legal/privacy", props: { lastUpdated: LAST_UPDATED }
  end

  def terms
    render inertia: "legal/terms", props: { lastUpdated: LAST_UPDATED }
  end

  def data_deletion
    render inertia: "legal/data-deletion", props: { lastUpdated: LAST_UPDATED }
  end
end
