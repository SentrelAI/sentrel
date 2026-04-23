# Alchemy engine — one image per agent.
#
# Runs on Fly Machines (primary), Hetzner, DigitalOcean, or any Docker host.
# Image is agent-agnostic; the running agent is selected at runtime via the
# EMPLOYEE_ID env var, injected by the provisioner at machine-create time.
#
# Companions (sibling containers on the same machine, same `/data` volume):
#   - askjo/camofox-browser — stealth Firefox HTTP service on :9377
#   - askjo/display-stack    — Xvfb + x11vnc + noVNC for live-screen view (optional,
#                              future Phase 3). Not required for headless operation.
#
# Ports exposed by this image:
#   3300  — engine gateway (HTTP + WebSocket). Rails reaches it here.
#
# Size budget: ~600-800 MB. Bun + node_modules + a few OS utilities.

# --- Stage 1: install deps ----------------------------------------------------
FROM oven/bun:1.1.38-slim AS deps

WORKDIR /srv/engine

# Copy lock + manifest first for layer caching on dep-only changes
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# --- Stage 2: runtime image ---------------------------------------------------
FROM oven/bun:1.1.38-slim AS runtime

# System packages needed at runtime:
#   - poppler/tesseract — PDF extraction fallbacks (engine/rag/extractor.ts)
#   - ffmpeg             — media conversion for voice notes
#   - ca-certificates + curl — TLS + healthcheck
#   - tini               — PID 1 zombie reaper
RUN apt-get update && apt-get install -y --no-install-recommends \
      poppler-utils tesseract-ocr \
      ffmpeg \
      ca-certificates curl \
      tini \
    && rm -rf /var/lib/apt/lists/*

# Non-root user. Everything persistent lives in /data, which the provisioner
# mounts as a volume. Agent state survives restarts because /data does.
# (The oven/bun base image already has a 'bun' user at uid 1000, so we let
#  useradd pick the next free uid instead of forcing a specific one.)
RUN useradd --create-home --shell /bin/bash engine
WORKDIR /srv/engine

# node_modules from the builder stage
COPY --from=deps /srv/engine/node_modules ./node_modules

# Engine source (see .dockerignore for exclusions)
COPY --chown=engine:engine . .

# /data is the single persistent mount. Everything else is ephemeral.
# Layout inside /data matches config.dataDir = "/data":
#   /data/memories/         — memory.md
#   /data/skills/           — SKILL.md files (re-provisioned on /sync)
#   /data/workspace/        — agent's working files (outbox, screenshots, notes)
#   /data/rag/              — per-agent + per-org SQLite vector stores
#   /data/camofox/          — Camofox profile + cookies (shared with sibling)
ENV DATA_DIR=/data
RUN mkdir -p /data/memories /data/skills /data/workspace /data/rag /data/camofox \
    && chown -R engine:engine /data
VOLUME ["/data"]

USER engine

# Health probe — Fly / k8s reads this
EXPOSE 3300
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS http://localhost:3300/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["bun", "run", "src/main.ts"]
