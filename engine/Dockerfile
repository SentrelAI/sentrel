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
# Debian (glibc) base — onnxruntime-node + tesseract + several other native
# deps ship glibc-linked binaries. We avoid the claude-agent-sdk's ENOENT by
# overriding pathToClaudeCodeExecutable to the bundled JS CLI at runtime,
# so we never need the SDK's native platform binary at all.
FROM oven/bun:1.1.38-slim AS deps

WORKDIR /srv/engine

# Copy lock + manifest first for layer caching on dep-only changes.
# NOT --frozen-lockfile: the lockfile is generated on the developer's Mac
# and skips Linux-only platform optional deps (see Bun issue #26156).
#
# Bun installs BOTH the glibc and musl variants of claude-agent-sdk's
# native binary (both declare os: linux). The SDK's resolver tries musl
# first — on Debian/glibc that spawn fails with ENOENT. Deleting the
# musl copies forces the resolver to fall through to the glibc variant.
COPY package.json bun.lock ./
RUN bun install \
  && rm -rf \
       node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl \
       node_modules/@anthropic-ai/claude-agent-sdk-linux-arm64-musl

# --- Stage 2: runtime image ---------------------------------------------------
# Debian 12 (bookworm), with Bun copied in from the deps stage. Every
# oven/bun:1.1.38 variant is Debian 11 (bullseye), whose security archive
# left deb.debian.org when its LTS ended — the apt-get install below started
# 404ing (Sep 2026) and :latest stopped updating. Bun is one glibc binary,
# so the version stays pinned while the OS underneath is supported again.
FROM debian:bookworm-slim AS runtime
COPY --from=deps /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s /usr/local/bin/bun /usr/local/bin/bunx

# System packages needed at runtime:
#   - poppler / tesseract — PDF extraction fallbacks (rag/extractor.ts)
#   - ffmpeg              — media conversion for voice notes
#   - ca-certificates + curl — TLS + healthcheck
#   - tini                — PID 1 zombie reaper
#   - gnupg               — required to add the NodeSource apt key below
#   - chromium runtime libs — for headless Chrome (Puppeteer, video-render
#     pipelines like HyperFrames). We DON'T install chromium itself —
#     Puppeteer downloads its own browser to PUPPETEER_CACHE_DIR (set
#     below to /data so it persists across machine restarts). We only
#     need the OS-level shared libs Chrome's binary links against.
RUN apt-get update && apt-get install -y --no-install-recommends \
      poppler-utils tesseract-ocr \
      ffmpeg \
      ca-certificates curl gnupg \
      tini \
      fonts-liberation libnss3 libatk-bridge2.0-0 libatk1.0-0 \
      libcups2 libdrm2 libgbm1 libgtk-3-0 libpango-1.0-0 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxshmfence1 \
      libasound2 libxkbcommon0 xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Node.js 22 — lives alongside Bun. Bun stays the engine's runtime; Node
# is here for the small set of agent tools that explicitly require it
# (HyperFrames + other Puppeteer-driven renderers, MCP servers shipped
# as Node-only npm packages). `npx` and `node --version` both work.
#
# Installed from the official prebuilt tarball, NOT via apt. The
# NodeSource apt repo's post-install scripts trigger a libc-bin
# reconfigure that segfaults under QEMU when building linux/arm64 on
# an amd64 CI host (Debian 11's glibc 2.31 vs QEMU's user-mode emulator).
# Tarball install skips the package manager entirely → no segfault.
ARG NODE_VERSION=22.22.3
# .tar.gz (not .tar.xz) because the slim base doesn't ship the xz
# binary and we don't want to apt-install xz-utils just for this.
# Gzip is always present.
RUN ARCH="$(dpkg --print-architecture)" && \
    case "$ARCH" in \
      amd64) NODE_ARCH=x64 ;; \
      arm64) NODE_ARCH=arm64 ;; \
      *) echo "Unsupported architecture: $ARCH" && exit 1 ;; \
    esac && \
    curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.gz" \
      | tar -xz -C /usr/local --strip-components=1 \
        --exclude="*/CHANGELOG.md" --exclude="*/LICENSE" --exclude="*/README.md" && \
    node --version && npm --version

# Non-root user. Everything persistent lives in /data, which the provisioner
# mounts as a volume. Agent state survives restarts because /data does.
RUN useradd --create-home --shell /bin/bash engine
WORKDIR /srv/engine

# node_modules from the builder stage — chown so the engine user can write
# caches under node_modules (e.g. onnxruntime-node's model dir).
COPY --from=deps --chown=engine:engine /srv/engine/node_modules ./node_modules

# Engine source (see .dockerignore for exclusions)
COPY --chown=engine:engine . .

# Ensure the engine user has a writable XDG cache dir for libraries that
# download models at runtime (e.g. @huggingface/transformers).
RUN mkdir -p /home/engine/.cache && chown -R engine:engine /home/engine

# Pre-bake Xenova/all-MiniLM-L6-v2 (~25MB) into /opt/hf-cache so runtime
# doesn't hit the Bun + transformers.js streaming-fs hang we saw on Fly
# (config.json.tmp.* files left mid-write, embeddings never initialize).
# env.cacheDir in tool-embeddings.ts points here; filesystem is baked,
# not on the /data volume, so Fly's volume mount can't shadow it.
# HuggingFace rate-limits (HTTP 429) anonymous downloads, which was failing
# the build intermittently and leaving :latest stale. Retry every file with
# backoff (curl --retry treats 429/5xx/transient as retryable), and prefer
# an HF_TOKEN when the build provides one (much higher rate limit).
ARG HF_TOKEN=""
RUN mkdir -p /opt/hf-cache/Xenova/all-MiniLM-L6-v2/onnx && \
    cd /opt/hf-cache/Xenova/all-MiniLM-L6-v2 && \
    AUTH=""; [ -n "$HF_TOKEN" ] && AUTH="-H \"Authorization: Bearer $HF_TOKEN\""; \
    dl() { eval curl -fsSL --retry 8 --retry-delay 5 --retry-all-errors $AUTH -o "$1" "$2"; }; \
    base="https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main"; \
    dl config.json            "$base/config.json" && \
    dl tokenizer.json         "$base/tokenizer.json" && \
    dl tokenizer_config.json  "$base/tokenizer_config.json" && \
    dl special_tokens_map.json "$base/special_tokens_map.json" && \
    dl onnx/model.onnx        "$base/onnx/model.onnx" && \
    chown -R engine:engine /opt/hf-cache

# /data is the single persistent mount. Everything else is ephemeral.
# Layout inside /data matches config.dataDir = "/data":
#   /data/memories/         — memory.md
#   /data/skills/           — SKILL.md files (re-provisioned on /sync)
#   /data/workspace/        — agent's working files (outbox, screenshots, notes)
#   /data/rag/              — per-agent + per-org SQLite vector stores
#   /data/camofox/          — Camofox profile + cookies (shared with sibling)
#   /data/hf-cache/         — @huggingface/transformers model cache
ENV DATA_DIR=/data
# Point transformer libraries at the persistent volume so the ~25 MB
# MiniLM-L6-v2 model downloads once per agent and survives restarts.
# Without this, onnxruntime + transformers default to node_modules/.cache
# which isn't writable after Fly mounts /data over a fresh volume.
ENV HF_HOME=/data/hf-cache
ENV TRANSFORMERS_CACHE=/data/hf-cache
ENV XDG_CACHE_HOME=/data/hf-cache
# Puppeteer downloads Chrome on first run (~280 MB). Point it at /data
# so it lives on the persistent volume — one download per agent, kept
# across restarts. Without this, every cold-boot would re-download.
ENV PUPPETEER_CACHE_DIR=/data/.puppeteer-cache
RUN mkdir -p /data/memories /data/skills /data/workspace /data/rag /data/camofox /data/hf-cache /data/.puppeteer-cache \
    && chown -R engine:engine /data
VOLUME ["/data"]

USER engine

# Health probe — Fly / k8s reads this
EXPOSE 3300
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS http://localhost:3300/health || exit 1

ENTRYPOINT ["tini", "--"]
CMD ["bun", "run", "src/main.ts"]
