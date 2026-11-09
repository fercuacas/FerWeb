FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
ARG SOURCE_DATE_EPOCH=0
WORKDIR /runner
COPY apps/runner/*.mjs ./
COPY apps/sandbox/protected-paths.mjs ./
CMD ["node", "server.mjs"]
