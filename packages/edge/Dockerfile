FROM node:22-slim

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
COPY packages/edge/package.json packages/edge/
COPY packages/common/package.json packages/common/
COPY packages/web/package.json packages/web/

# Install dependencies including wrangler
RUN npm ci

# Copy configuration and source files
COPY tsconfig.base.json ./
COPY packages/common ./packages/common
COPY packages/edge ./packages/edge

WORKDIR /app/packages/edge

EXPOSE 8080

ENTRYPOINT ["sh", "./start.sh"]
