FROM node:20-alpine

# Install PM2 globally
RUN npm install -g pm2

RUN mkdir -p /usr/src/node-app && chown -R node:node /usr/src/node-app

WORKDIR /usr/src/node-app

COPY package.json yarn.lock ./

USER node

RUN yarn install --pure-lockfile

COPY --chown=node:node . .

EXPOSE 3000

# Run both API and worker using PM2
CMD ["pm2-runtime", "ecosystem.config.json"]
