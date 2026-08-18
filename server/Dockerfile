# Node 22+ required. The original reason was the built-in node:sqlite module;
# persistence has since moved to Postgres (via PGlite locally), but 22 is still
# the floor — the toolchain and @electric-sql/pglite both expect it.
FROM node:22-slim AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime

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
