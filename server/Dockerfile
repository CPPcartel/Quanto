# Node 24, and the npm it ships with, is what this image needs.
#
# 22 was the floor for the language features; the reason for 24 is npm. The
# lockfile is written by npm 11, which marks bufferutil and utf-8-validate —
# ws's optional native accelerators — as `optional: true`. npm 10, which
# node:22-slim ships, does not read those entries the same way and fails the
# build with "Missing: utf-8-validate@5.0.10 from lock file". `npm ci` is
# strict by design, so the fix is to match the npm that wrote the lockfile
# rather than to loosen the install.
FROM node:24-slim AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------------------------------------------------------------------------
FROM node:24-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# The database lives on a mounted volume, not in the image — a container's own
# filesystem is discarded on every redeploy.
# Only used when DATABASE_URL is unset. With a Postgres URL set, nothing is
# written here and no volume is needed.
ENV DATA_DIR=/data
RUN mkdir -p /data

EXPOSE 2567

# Colyseus is a long-lived stateful process; it must not be run serverless.
CMD ["node", "dist/index.js"]
