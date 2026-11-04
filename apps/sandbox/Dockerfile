FROM node:24.22.2-bookworm-slim@sha256:c86ecead9e55a5210ac1727de38a4ca840bf03dcaf34dc9749addbf383b1920c
ARG SOURCE_DATE_EPOCH=0
RUN sed -i 's|http://deb.debian.org/debian-security|http://snapshot.debian.org/archive/debian-security/20261101T000000Z|g; s|http://deb.debian.org/debian|http://snapshot.debian.org/archive/debian/20261101T000000Z|g' /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Check-Valid-Until=false update \
    && apt-get install -y --no-install-recommends git=1:2.39.5-0+deb12u3 ripgrep=13.0.0-4+b2 ca-certificates=20250419~deb12u2 \
    && rm -rf /var/lib/apt/lists/*
COPY apps/sandbox/tooling/package*.json /opt/codex/
RUN --mount=type=secret,id=npm_ca \
    if [ -f /run/secrets/npm_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/npm_ca; fi; \
    npm ci --prefix /opt/codex --ignore-scripts --no-audit --no-fund \
    && ln -s /opt/codex/node_modules/.bin/codex /usr/local/bin/codex
COPY apps/sandbox/*.mjs /opt/ferweb/
WORKDIR /workspace
ENTRYPOINT ["node", "/opt/ferweb/entry.mjs"]
