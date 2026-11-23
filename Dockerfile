FROM node:24-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/finance.db
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/index.js"]
