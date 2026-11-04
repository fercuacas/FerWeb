FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS build
ARG SOURCE_DATE_EPOCH=0
RUN --mount=type=secret,id=npm_ca \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm install --global npm@11.19.1 --no-audit --no-fund
WORKDIR /app
COPY package.json package-lock.json .npmrc tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
RUN --mount=type=secret,id=npm_ca \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci --no-audit --no-fund
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN npm run build -w @ferweb/contracts && npm run build -w @ferweb/api && chown -R node:node /app
USER node
WORKDIR /app/apps/api
EXPOSE 3001
FROM build AS production-dependencies
USER root
WORKDIR /app
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund

FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS runtime
ARG SOURCE_DATE_EPOCH=0
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/migrations ./apps/api/migrations
USER node
WORKDIR /app/apps/api
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "dist/server.js"]

FROM build AS development
CMD ["npm", "run", "dev"]
