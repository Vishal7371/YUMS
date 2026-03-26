FROM ghcr.io/puppeteer/puppeteer:22.15.0

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

WORKDIR /app

# Copy server files
COPY server/package*.json ./
RUN npm ci --only=production

COPY server/ ./
COPY client/ ./client/

EXPOSE 3001

CMD ["node", "index.js"]
