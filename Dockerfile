# OmniCRM — Next app + sync worker (Telegram MTProto, WhatsApp & X via Chromium)
FROM node:20-slim

# Use the distro's Chromium instead of downloading puppeteer's, and install the
# shared libraries WhatsApp Web / XChat need to render headless.
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates fonts-liberation fonts-noto-color-emoji \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libcairo2 libcups2 libdbus-1-3 \
    libexpat1 libfontconfig1 libgbm1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 \
    libpango-1.0-0 libpangocairo-1.0-0 libx11-6 libx11-xcb1 libxcb1 \
    libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 \
    libxrandr2 libxrender1 libxss1 libxtst6 ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate && npm run build

# Persist DB + login sessions here (mount a Railway volume at /data).
ENV DATA_DIR=/data
RUN mkdir -p /data

EXPOSE 3000
CMD ["node", "start.js"]
