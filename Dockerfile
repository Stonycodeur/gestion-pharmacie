FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache su-exec
COPY package.json ./
RUN npm install --omit=dev --include=optional --no-audit --no-fund
COPY server ./server
COPY web ./web
COPY tools ./tools
COPY database ./database
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Fins de ligne Windows (CRLF) et droit d'exécution perdus lors d'un envoi par GitHub : on les rétablit dans l'image
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh && chmod +x /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /app/data/uploads && chown -R node:node /app/data
EXPOSE 3000
ENTRYPOINT ["/bin/sh", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
