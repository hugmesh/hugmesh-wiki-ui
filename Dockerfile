# hugmesh-wiki-ui — builds the Wiki management native-federation REMOTE
# (src → dist/wiki/browser) and serves it via nginx with CORS so the
# hugmesh.net host can fetch its remoteEntry.json cross-origin.
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
# --base-href is REQUIRED, not cosmetic. Without it Angular emits asset URLs
# rooted at / , but the gateway serves this app under /wiki/ — so every
# bundle request lands on the SPA catch-all and comes back as index.html with
# HTTP 200 and content-type text/html instead of JS. The browser then fails
# with a syntax/JSON parse error on markup, which reads as a corrupt build
# rather than a routing problem. tube-ui and user-ui already carry this flag.
RUN npm run build:wiki -- --base-href=/wiki/

FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/wiki/browser /usr/share/nginx/html
EXPOSE 8080

#### Runtime THEME injection (the fleet-wide login-ui 50-snap-theme.sh
#### mechanism; see hugmesh-host-shell PR #11 for the full rationale). The hook
#### writes $SNAP_THEME_CSS verbatim at container start; nginx serves it via
#### the exact-match /snap-theme.css alias. /tmp, NOT the docroot: on the
#### nginx-unprivileged images uid 101 cannot write the docroot, and on the
#### root images /tmp is equally correct — ONE stanza for the whole fleet.
#### COPY --chmod, NOT COPY + RUN chmod: unprivileged final stages run as
#### uid 101 and a RUN chmod on root-owned COPY output exits 1 (BuildKit is
#### always on for this stack: Makefile DOCKER_BUILDKIT=1).
COPY --chmod=0755 docker-entrypoint.d/50-snap-theme.sh /docker-entrypoint.d/50-snap-theme.sh
ENV SNAP_THEME_OUT=/tmp/snap-theme.css
