FROM node:24

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && mkdir -p uploads/recordings \
    && chown node:node uploads/recordings
COPY . .

USER node
CMD ["node", "server.js"]
