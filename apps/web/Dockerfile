# Image web : SPA Vite servie par nginx (non root), qui relaie /api vers le conteneur API.
# Contexte de build : racine du dépôt (le paquet partagé est consommé en source).
#   docker build -f apps/web/Dockerfile -t flowboard/web .

# ---------- Build ----------
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci -w @flowboard/shared -w @flowboard/web
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @flowboard/web

# ---------- Runtime ----------
FROM nginxinc/nginx-unprivileged:1.27-alpine
# Gabarit lu au démarrage (envsubst) : API_UPSTREAM, MAX_BODY_SIZE.
ENV API_UPSTREAM=api:3000 MAX_BODY_SIZE=30m
COPY apps/web/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
