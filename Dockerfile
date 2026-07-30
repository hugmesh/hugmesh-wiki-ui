# hugmesh-wiki-ui — builds the Wiki management native-federation REMOTE
# (src → dist/wiki/browser) and serves it via nginx with CORS so the
# hugmesh.systems host can fetch its remoteEntry.json cross-origin.
#
# Serves on :8080 to MATCH the federation-api wiki module registration (#16):
#   remote_entry_url = http://hugmesh-wiki-ui:8080/remoteEntry.json
# The remoteEntry.json the production build emits exposes ./Wiki (the host
# loadRemoteModule('wiki','./Wiki') mounts WIKI_ROUTES at the apex path /wiki).
#
# visibility=internal: the wiki remote is reachable only behind the gateway's
# /wiki=ROLE_WIKI route-access gate (admin|superadmin|mod+ROLE_WIKI, plus a
# granted USER) — it is NOT a public surface. Deployed to hugmesh-frontend.
# Consumes same-origin /bff/wiki/** (the hugmesh-wiki-bff-api content store +
# grant/timeout/ban overlay). Angular CLI 22 requires Node >= 24.15.
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build:wiki

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/wiki/browser /usr/share/nginx/html
EXPOSE 8080
