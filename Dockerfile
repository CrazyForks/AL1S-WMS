# syntax=docker/dockerfile:1
FROM node:24-alpine AS build

ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN npm config set registry "$NPM_REGISTRY" \
  && npm install --global pnpm@10.32.1

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile

COPY apps ./apps
COPY packages ./packages
RUN pnpm build \
  && pnpm --filter @family-erp/api deploy --prod --legacy /app/runtime

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
ENV PORT=8080
ENV BIND_ADDRESS=0.0.0.0
ENV DATABASE_URL=/data/family-erp.db
ENV STATIC_ROOT=/app/public

WORKDIR /app
COPY --from=build /app/runtime ./
COPY --from=build /app/apps/web/dist ./public

RUN mkdir -p /data && chown -R node:node /app /data
USER node

EXPOSE 8080
VOLUME ["/data"]
CMD ["./node_modules/.bin/tsx", "dist/server.js"]
