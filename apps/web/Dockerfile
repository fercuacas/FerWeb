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
COPY apps/web apps/web
RUN npm run build -w @ferweb/contracts && npm run build -w @ferweb/web && chown -R node:node /app
USER node
WORKDIR /app/apps/web
EXPOSE 5173
FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c AS runtime
ARG SOURCE_DATE_EPOCH=0
WORKDIR /app/apps/web
COPY --from=build /app/apps/web/dist ./dist
COPY apps/web/serve.mjs ./serve.mjs
USER node
ENV NODE_ENV=production
EXPOSE 5173
CMD ["node", "serve.mjs"]

FROM build AS development
CMD ["npm", "run", "dev"]
