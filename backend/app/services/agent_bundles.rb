# Shared error types for the agent-bundle pipeline. Defined here (the
# Zeitwerk namespace file) rather than inside Fetcher/Manifest so that
# `AgentBundles::FetchError` resolves even on code paths that never load
# those classes — e.g. a wizard deploy of an expired CLI upload raises
# FetchError without ever touching Fetcher.
module AgentBundles
  class FetchError < StandardError; end
  class InvalidBundle < StandardError; end
end
