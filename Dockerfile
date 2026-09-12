# Fyzio — zero-dependency Node 22 server + SQLite. One image, one process.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY client ./client
ENV NODE_ENV=production PORT=8080 DB_PATH=/data/fyzio.sqlite
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server/index.js"]
