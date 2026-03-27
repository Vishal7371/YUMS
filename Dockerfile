FROM ghcr.io/puppeteer/puppeteer:22.15.0

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Switch to root to set up the app directory
USER root
RUN apt-get update && apt-get install -y dbus --no-install-recommends \
    && rm -rf /var/lib/apt/lists/* \
    && dbus-uuidgen > /etc/machine-id \
    && mkdir -p /run/dbus
RUN mkdir -p /app && chown -R pptruser:pptruser /app

# Switch back to pptruser for security
USER pptruser
WORKDIR /app

# Copy and install server dependencies
COPY --chown=pptruser:pptruser server/package*.json ./server/
RUN cd server && npm ci --only=production

# Copy server and client code
COPY --chown=pptruser:pptruser server/ ./server/
COPY --chown=pptruser:pptruser client/ ./client/

EXPOSE 3001

WORKDIR /app/server
CMD ["node", "index.js"]
