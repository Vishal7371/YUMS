FROM ghcr.io/puppeteer/puppeteer:22.15.0

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /app

# Copy and install server dependencies
COPY server/package*.json ./server/
RUN cd server && npm ci --only=production

# Copy server and client code
COPY server/ ./server/
COPY client/ ./client/

EXPOSE 3001

WORKDIR /app/server
CMD ["node", "index.js"]
