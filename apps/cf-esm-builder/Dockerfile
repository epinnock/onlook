# syntax=docker/dockerfile:1.7
#
# cf-esm-builder Container image (TH1.1)
# Runs Metro + Hermes to bundle Expo SDK 54 projects into a single JSBundle
# on behalf of the cf-esm-builder Cloudflare Worker Container DO.
#
# Target: Expo SDK 54 (expo@54.0.0, react-native@0.81.0, react@19.1.0)
# Constraints: glibc (NOT Alpine — Hermes binaries are glibc-compiled),
# multi-stage build, pinned versions, ≤ 800 MB final image.

# ---------------------------------------------------------------------------
# Stage 1: deps — install Expo CLI + Hermes compiler
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS deps

# Pinned toolchain versions (match container/__tests__/fixtures/minimal-expo)
ARG EXPO_VERSION=54.0.0
ARG EXPO_CLI_VERSION=0.24.24
ARG REACT_NATIVE_VERSION=0.81.0

# System deps Metro/Hermes need at install time
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    build-essential \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# npm config — survive flaky network during cold image builds
RUN npm config set fetch-retries 5 \
    && npm config set fetch-retry-mintimeout 60000 \
    && npm config set fetch-retry-maxtimeout 300000 \
    && npm config set fetch-timeout 600000

# Pre-install Expo + @expo/cli globally so per-build cost is just Metro.
# Pinned exact versions — no `latest`, no `~`.
# Single combined install so npm dedupes the dependency tree on one resolve.
RUN npm install -g \
        expo@${EXPO_VERSION} \
        @expo/cli@${EXPO_CLI_VERSION} \
    && npm cache clean --force

# Pre-install hermesc (the Hermes compiler) — ships with react-native@0.81+
# under node_modules/react-native/sdks/hermesc/linux64-bin/hermesc.
# Mirror it to /usr/local/bin so build.sh can call `hermes` directly.
# react-native install: ~150 MB; the only reason it's here is the Hermes
# binary, so we delete the rest after copying.
RUN mkdir -p /tmp/hermes-stage && cd /tmp/hermes-stage \
    && npm init -y \
    && npm install --no-audit --no-fund --no-progress \
        react-native@${REACT_NATIVE_VERSION} \
    && cp node_modules/react-native/sdks/hermesc/linux64-bin/hermesc /usr/local/bin/hermes \
    && chmod +x /usr/local/bin/hermes \
    && cd / && rm -rf /tmp/hermes-stage \
    && npm cache clean --force

# ---------------------------------------------------------------------------
# Stage 2: runtime — slim image that just runs the entrypoint
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim AS runtime

# Copy global Expo CLI + hermes binary from the deps stage
COPY --from=deps /usr/local/lib/node_modules /usr/local/lib/node_modules
COPY --from=deps /usr/local/bin /usr/local/bin

# Minimal runtime system packages (tar/gzip for unpacking the input tarball)
RUN apt-get update && apt-get install -y --no-install-recommends \
    tar \
    gzip \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Working directories used by the entrypoint (TH1.2)
RUN mkdir -p /input /output /work

# Entrypoint script — TH1.2 lands the real implementation at this exact path.
COPY container/build.sh /usr/local/bin/build.sh
RUN chmod +x /usr/local/bin/build.sh

# Smoke-test the toolchain at build time so cold-start failures surface during
# `docker build` rather than at container runtime. `|| true` keeps the layer
# from failing on transient `--version` quirks — the symlinks themselves are
# verified by the preceding COPY.
RUN node --version && expo --version && hermes --version || true

# The cf-esm-builder Worker's Container DO sends the source tar via the
# Cloudflare Containers protocol; the entrypoint reads it and emits a JSON
# response describing the bundle artifact (see TH0.3).
ENTRYPOINT ["/usr/local/bin/build.sh"]
