# ---------- build: compile the bot (TypeScript) and the Activity web app (Vite)
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
COPY web ./web
RUN npm run build && npm prune --omit=dev

# ---------- runtime
FROM node:24-alpine
RUN apk add --no-cache su-exec
ENV NODE_ENV=production \
    DATA_DIR=/appdata \
    PORT=3000
WORKDIR /app

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --chmod=755 docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# Everything persistent (SQLite database) lives in /appdata. Mount a volume there.
# The entrypoint fixes its ownership and then drops to the unprivileged "node" user.
RUN mkdir -p /appdata && chown node:node /appdata
VOLUME ["/appdata"]

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1

ENTRYPOINT ["entrypoint.sh"]
CMD ["node", "dist/index.js"]
