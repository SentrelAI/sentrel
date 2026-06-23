# Self-hosted Nango + a tiny Caddy reverse proxy baked in, so ONE public domain
# (connect.sentrel.ai:443) serves both the Nango API (:3003) and the Connect UI
# (:3009) by path. Caddy listens on :8080 (the Fly internal_port); fly-proxy
# terminates TLS and forwards to it.
FROM caddy:2-alpine AS caddybin

FROM nangohq/nango-server:hosted
# Grab the static Caddy binary from the official image — no apt needed.
COPY --from=caddybin /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
COPY start.sh /usr/local/bin/start-with-proxy.sh
RUN chmod +x /usr/local/bin/start-with-proxy.sh
WORKDIR /app/nango
# The base image's ENTRYPOINT (docker-entrypoint.sh) execs this CMD.
CMD ["/usr/local/bin/start-with-proxy.sh"]
