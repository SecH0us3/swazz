FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS builder

WORKDIR /app

# Copy dependency files first for better caching
# This layer is only rebuilt when package files change
COPY package.json package-lock.json ./
COPY packages/web/package.json packages/web/
COPY packages/edge/package.json packages/edge/

# Install dependencies (cached layer)
RUN npm ci

# Copy configuration files
COPY tsconfig.base.json ./
COPY packages/web/tsconfig.json packages/web/

# Copy remaining source files
COPY ai.txt llms.txt llms-full.txt ./
COPY packages/web ./packages/web
COPY packages/edge ./packages/edge

# Build the application
RUN npm run build --workspace=packages/web

FROM nginx:alpine@sha256:b4f40fc790074a4af0d6fc81923a30459910d6f01efc048246ef288b14654354

# Copy built application
COPY --from=builder /app/packages/web/dist /usr/share/nginx/html

# Copy nginx configuration
COPY packages/web/nginx.conf /etc/nginx/conf.d/default.conf

# Security: Set restrictive permissions on files
RUN chmod 755 /usr/share/nginx/html && \
    find /usr/share/nginx/html -type f -exec chmod 644 {} \; && \
    find /usr/share/nginx/html -type d -exec chmod 755 {} \; && \
    # Hide nginx version
    sed -i 's/^http {/http {\n    server_tokens off;/' /etc/nginx/nginx.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
