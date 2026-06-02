FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/web/package.json packages/web/
COPY packages/edge/package.json packages/edge/

RUN npm ci

COPY ai.txt llms.txt llms-full.txt ./
COPY packages/web ./packages/web
COPY packages/edge ./packages/edge

# The vite config outputs to ../container/web/dist, so we need to copy it from there.
RUN npm run build --workspace=packages/web

FROM nginx:alpine
# Note the path: Vite outputs to ../container/web/dist relative to packages/web
# which is /app/packages/container/web/dist from /app
COPY --from=builder /app/packages/container/web/dist /usr/share/nginx/html
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
