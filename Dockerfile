FROM node:20-alpine

# Install Chromium + fonts for Puppeteer PDF rendering
RUN apk add --no-cache \
  chromium \
  nss \
  freetype \
  harfbuzz \
  ca-certificates \
  ttf-freefont

RUN mkdir -p /usr/src/node-app && chown -R node:node /usr/src/node-app

WORKDIR /usr/src/node-app

COPY package.json yarn.lock ./

# Use system Chromium instead of downloading during install
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

USER node

RUN yarn install --pure-lockfile

COPY --chown=node:node . .

EXPOSE 3000

# Enable embedded worker (runs in same process as API)
ENV EMBEDDED_WORKER=true

# Run API with embedded worker
CMD ["node", "src/index.js"]
