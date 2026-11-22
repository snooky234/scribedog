# syntax=docker/dockerfile:1
#
# Built from the repository root (see docker-compose.yml: context "..") because
# the web client is the desktop app's own frontend under /src, built with
# `npm run build:web` from the root package. The root .dockerignore keeps
# everything else (Rust target directory, node_modules, docs) out of the
# build context.

# ---- web: the shared frontend, built for the browser -------------------------
# Pinned to the build platform: the output is plain JS, CSS and assets, which
# are identical whatever the target architecture, so building this stage once
# per target buys nothing. It is also the expensive one (npm ci plus the Vite
# build were about six of the eight minutes of a healthy multi-arch run), and
# under QEMU it was where `npm ci` died with "uncaught target signal 4".
FROM --platform=$BUILDPLATFORM node:24-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json tsconfig.node.json THIRD_PARTY_LICENSES.md ./
COPY public ./public
COPY src ./src
RUN npm run build:web

# ---- server: TypeScript -> dist/server ---------------------------------------
FROM node:24-alpine AS server
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

# ---- deps: production node_modules only --------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ---- runtime -------------------------------------------------------------------
FROM node:24-alpine
ENV NODE_ENV=production \
    SCRIBEDOG_VAULT_PATH=/data \
    SCRIBEDOG_HOST=0.0.0.0 \
    SCRIBEDOG_PORT=3000 \
    SCRIBEDOG_WEB_DIST_DIR=/app/dist-web
WORKDIR /app/server
# su-exec drops from root to PUID:PGID in the entrypoint (see docker-entrypoint.sh).
RUN apk add --no-cache su-exec
COPY --from=deps /app/server/node_modules ./node_modules
COPY --from=server /app/server/dist ./dist
COPY --from=web /app/dist-web /app/dist-web
COPY server/package.json ./
# The certificate script, run as `docker compose run --rm certificates`: it
# ships with the image so it always matches the version that uses its files.
COPY server/scripts ./scripts
COPY --chmod=755 server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# The vault is a bind mount; the directory only exists here so a container
# started without one still has somewhere writable.
RUN mkdir -p /data && chown node:node /data
EXPOSE 3000
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "dist/server/healthcheck.js"]
# The container starts as root and drops to PUID:PGID, see docker-entrypoint.sh.
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/server/index.js"]
