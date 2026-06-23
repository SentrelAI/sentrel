#!/bin/sh
# Start the Caddy reverse proxy in the background, then hand off to Nango's
# normal entrypoint (which runs the API server :3003 + Connect UI :3009).
set -e
caddy start --config /etc/caddy/Caddyfile --adapter caddyfile
exec sh packages/server/entrypoint.sh
