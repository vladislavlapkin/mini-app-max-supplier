# Сборка фронтенда и сервера одной командой: docker compose up --build

FROM node:22-alpine AS webapp
WORKDIR /build/webapp
COPY webapp/package.json webapp/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY webapp/ ./
RUN npm run build

FROM node:22-alpine AS server
WORKDIR /build/server
COPY server/package.json server/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY server/ ./
COPY data /build/data
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    NODE_EXTRA_CA_CERTS=/app/server/certs/russian_trusted_ca.pem \
    DATA_DIR=/app/data \
    MIGRATIONS_DIR=/app/server/migrations \
    WEBAPP_DIST=/app/webapp/dist
WORKDIR /app/server
COPY --from=server /build/server/package.json ./package.json
COPY --from=server /build/server/node_modules ./node_modules
COPY --from=server /build/server/dist ./dist
COPY server/migrations ./migrations
COPY server/certs ./certs
COPY data /app/data
COPY --from=webapp /build/webapp/dist /app/webapp/dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "dist/index.js"]
