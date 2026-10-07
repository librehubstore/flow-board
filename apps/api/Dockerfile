# Image API (NestJS). Contexte de build : racine du dépôt (monorepo : packages/shared est requis).
#   docker build -f apps/api/Dockerfile -t flowboard/api .

# ---------- Build ----------
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w @flowboard/shared -w @flowboard/api
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @flowboard/shared && npm run build -w @flowboard/api

# ---------- Runtime : dépendances de production uniquement ----------
FROM node:24-slim
ENV NODE_ENV=production PORT=3000 UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --omit=dev -w @flowboard/api && npm cache clean --force \
  && mkdir -p /data/uploads && chown node:node /data/uploads
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/dist apps/api/dist
USER node
EXPOSE 3000
VOLUME /data/uploads
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]
