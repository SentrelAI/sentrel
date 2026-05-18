// Single source of truth for "where is the Rails app?" URL resolution.
// Every place in the engine that constructs a public-facing URL for the
// user (download links, /api/blobs/<id>, /pending_approvals/<id> deep
// links) goes through this — otherwise we end up with a mix of envs
// checked in different orders + localhost: leaks through when one env
// var happens to be unset on a particular machine.
//
// Resolution order, public-host-first so user-visible URLs are always
// HTTPS / production-host when possible:
//   1. WEBHOOK_BASE_URL    — explicit public host (set in deploy.yml)
//   2. RAILS_PUBLIC_URL    — alternate name some envs use
//   3. RAILS_INTERNAL_URL  — the engine→Rails secret-auth URL (also
//                            public-facing in our setup — same host)
//   4. RAILS_API_URL       — legacy alias, kept for compat
//   5. http://localhost:3200 — dev fallback only
//
// If you're a tool that POSTs to /api/* (engine→Rails comms, doesn't
// need to be public), prefer railsInternalUrl(). For anything the
// HUMAN will see (a link, a download URL, an email body), use
// railsPublicUrl().

const LOCALHOST_FALLBACK = "http://localhost:3200";

export function railsPublicUrl(): string {
  return (
    process.env.WEBHOOK_BASE_URL ||
    process.env.RAILS_PUBLIC_URL ||
    process.env.RAILS_INTERNAL_URL ||
    process.env.RAILS_API_URL ||
    LOCALHOST_FALLBACK
  );
}

export function railsInternalUrl(): string {
  return (
    process.env.RAILS_INTERNAL_URL ||
    process.env.RAILS_API_URL ||
    process.env.WEBHOOK_BASE_URL ||
    LOCALHOST_FALLBACK
  );
}

// Returns true if we're producing a localhost URL while running on Fly
// (FLY_APP_NAME is set). That's almost always a stale-env bug — the
// machine was provisioned before WEBHOOK_BASE_URL / RAILS_INTERNAL_URL
// were added to the env. Operator fix: hit Reload on the agent's page.
export function isStalePublicUrl(): boolean {
  return !!process.env.FLY_APP_NAME && /localhost/.test(railsPublicUrl());
}
