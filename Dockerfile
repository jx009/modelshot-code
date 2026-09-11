ARG NODE_IMAGE=node:22.23.2-bookworm-slim
FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

FROM base AS build
COPY package.json package-lock.json .npmrc ./
RUN --mount=type=cache,target=/root/.npm NODE_OPTIONS=--use-env-proxy npm ci
COPY . .
# Building never needs a live database or deployment credentials.
RUN npm run build && NODE_OPTIONS=--use-env-proxy npm prune --omit=dev && rm -rf .next/cache

FROM base AS runtime
ENV NODE_ENV=production PORT=3000 C2PA_ENABLED=0
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json /app/next.config.js /app/prisma.config.ts ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/messages ./messages
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/scripts/ops.mjs ./scripts/ops.mjs
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/modelshot
USER node
EXPOSE 3000
ENTRYPOINT ["modelshot"]
CMD ["web"]
