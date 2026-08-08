# Patch Stash — Dockerfile
# Node 22 on Alpine keeps the image small (~50 MB base).
# npm only runs during the image build — never on the host.

FROM node:22-alpine

# Install build tools needed by better-sqlite3 (native addon)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy dependency manifests first so Docker layer caching means
# npm ci only reruns when package.json actually changes.
COPY package.json package-lock.json ./

# --omit=dev: no devDependencies in the image
# --frozen-lockfile: fail loudly if lockfile is out of sync
RUN npm ci --omit=dev

# Copy application source
COPY server/ ./server/
COPY public/ ./public/

# /app/data is the mount point for the host volume.
# Creating it here means the container starts cleanly even without a mount,
# which is useful for quick local testing.
RUN mkdir -p /app/data/files

EXPOSE 3000

# Run as non-root for basic security hygiene
RUN addgroup -S patchstash && adduser -S patchstash -G patchstash
RUN chown -R patchstash:patchstash /app
USER patchstash

CMD ["node", "server/index.js"]
