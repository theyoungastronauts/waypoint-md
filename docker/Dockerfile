# Waypoint — single container, single process (§16).
# Node 22 (pinned); Next.js standalone output; better-sqlite3 native module.

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# python3/make/g++ are here as a fallback in case better-sqlite3 needs to
# compile (it normally installs a prebuilt binary and skips this).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && corepack enable
WORKDIR /app

# ---- build stage: install deps and produce the standalone build ----
FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @waypoint/web build

# ---- runner stage: minimal image running the standalone server ----
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Migrations folder is copied to an absolute path; the app reads this at boot.
ENV WAYPOINT_MIGRATIONS_DIR=/app/drizzle
ENV WAYPOINT_DATA_DIR=/data
WORKDIR /app

# Next standalone output (traced node_modules + apps/web/server.js).
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
# Drizzle migrations run on boot (§6) — ship them into the image.
COPY --from=build /app/apps/web/drizzle ./drizzle

RUN mkdir -p /data
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
