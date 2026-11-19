FROM node:22-bookworm-slim AS node

FROM ubuntu:24.04

ARG AUDIVERIS_VERSION=5.11.0
ARG AUDIVERIS_DEB=Audiveris-${AUDIVERIS_VERSION}-ubuntu24.04-x86_64.deb

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    fonts-dejavu-core \
    libstdc++6 \
    xauth \
    xvfb \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /usr/share/applications /usr/share/desktop-directories /usr/share/icons \
  && curl -fsSL \
    -o /tmp/audiveris.deb \
    "https://github.com/Audiveris/audiveris/releases/download/${AUDIVERIS_VERSION}/${AUDIVERIS_DEB}" \
  && apt-get update \
  && apt-get install -y --no-install-recommends /tmp/audiveris.deb \
  && rm -f /tmp/audiveris.deb \
  && rm -rf /var/lib/apt/lists/*

RUN printf '%s\n' \
    '#!/bin/sh' \
    'exec xvfb-run -a -s "-screen 0 1280x1024x24" /opt/audiveris/bin/Audiveris "$@"' \
    > /usr/local/bin/audiveris-headless \
  && chmod +x /usr/local/bin/audiveris-headless

COPY --from=node /usr/local/bin/node /usr/local/bin/node

RUN useradd --create-home --uid 10001 omr \
  && mkdir -p /app /tmp/omr \
  && chown -R omr:omr /app /tmp/omr

WORKDIR /app

COPY src/lib/music/xml.js /app/src/lib/music/xml.js
COPY src/lib/music/voiceInference.js /app/src/lib/music/voiceInference.js
COPY omr-service /app/omr-service

RUN chown -R omr:omr /app

USER omr

ENV NODE_ENV=production \
    PORT=8788 \
    HOST=0.0.0.0 \
    OMR_TEMP_DIR=/tmp/omr \
    AUDIVERIS_BIN=/usr/local/bin/audiveris-headless \
    AUDIVERIS_VERSION=${AUDIVERIS_VERSION}

EXPOSE 8788

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8788/api/health || exit 1

CMD ["node", "omr-service/src/server.js"]
