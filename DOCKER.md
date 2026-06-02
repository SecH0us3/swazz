# Docker Deployment Guide for Swazz

This guide explains how to run Swazz using Docker and Docker Compose.

## Quick Start (Development)

```bash
# 1. Copy the example env file
cp .env.example .env

# 2. Start the services
docker compose up --build

# 3. Access the application
# Frontend: http://localhost:3000
# Backend API: http://localhost:8081/api
```

The application will start with:
- Frontend (React dashboard) on port 3000
- Backend (Go API server) on port 8081
- Default CORS origin: `http://localhost` (safe for local development)
- Private IPs fuzzing: enabled (safe for local development)

## Production Deployment

### 1. Configure Environment Variables

Before deploying, **always** customize the `.env` file with production values:

```bash
cp .env.example .env
# Edit .env with your production settings
```

**Critical Security Settings:**

```env
# NEVER use wildcard - specify your exact domain
ALLOWED_ORIGIN=https://your-domain.com

# NEVER allow private IP fuzzing in production
SWAZZ_ALLOW_PRIVATE_IPS=false
```

### 2. Build and Push Docker Images

If using a container registry:

```bash
docker compose build
docker tag swazz-frontend:latest your-registry/swazz-frontend:latest
docker tag swazz-backend:latest your-registry/swazz-backend:latest
docker push your-registry/swazz-frontend:latest
docker push your-registry/swazz-backend:latest
```

### 3. Deploy

```bash
docker compose up -d
```

### 4. Verify

```bash
# Check service health
docker compose ps

# View logs
docker compose logs -f frontend
docker compose logs -f backend
```

## Security Considerations

### CORS Configuration
- **Development**: `ALLOWED_ORIGIN=http://localhost` ✅
- **Production**: `ALLOWED_ORIGIN=https://your-domain.com` ✅
- **Never**: `ALLOWED_ORIGIN=*` ❌ (allows any domain)

### Private IP Fuzzing
- **Development**: `SWAZZ_ALLOW_PRIVATE_IPS=true` ✅ (safe, isolated network)
- **Production**: `SWAZZ_ALLOW_PRIVATE_IPS=false` ✅ (prevents internal access)

### Base Images
All Docker images are pinned to specific SHA-256 digests to ensure supply chain security:
- `node:20-alpine@sha256:fb4cd...` (builder stage)
- `nginx:alpine@sha256:b4f40...` (web server)

## Advanced Configuration

### Custom Ports

To expose frontend on a different port:

```yaml
# Option A: Temporary override file (compose.override.yml)
# Use with: docker compose -f compose.yml -f compose.override.yml up --build
services:
  frontend:
    ports:
      - "8080:80"  # Host 8080 -> container 80 (frontend)
```

# Option B: Parameterized ports via .env
The repository `compose.yml` supports parameterized host ports via environment variables. Defaults are:

- FRONTEND_PORT=3000  # host port mapped to container port 80 (frontend)
- BACKEND_PORT=8081   # host port mapped to container port 8080 (backend)

To change host ports without an override file, copy `.env.example` to `.env` and set your desired values:

```bash
# Example (.env)
FRONTEND_PORT=8080
BACKEND_PORT=8081
```

Then run:

```bash
docker compose up --build
```


### HTTPS/TLS

For production with SSL/TLS:

1. Use a reverse proxy (nginx, traefik) in front of the containers
2. Or modify `packages/web/nginx.conf` to include SSL configuration

Example with Traefik:
```yaml
services:
  frontend:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.swazz.rule=Host(`your-domain.com`)"
      - "traefik.http.routers.swazz.entrypoints=websecure"
      - "traefik.http.routers.swazz.tls.certresolver=letsencrypt"
```

### Networking

To connect to external APIs:

```yaml
# docker compose.override.yml
services:
  backend:
    environment:
      - EXTERNAL_API_ENDPOINT=https://your-api.com
```

## Troubleshooting

### Frontend not connecting to backend

1. Check CORS configuration:
   ```bash
   # Check if ALLOWED_ORIGIN matches your frontend domain
   docker compose logs backend | grep -i cors
   ```

2. Verify network connectivity:
   ```bash
   docker compose exec frontend curl -i http://backend:8080/api/health
   ```

### Port already in use

```bash
# Find process using port 80
lsof -i :80

# Change port in docker compose.override.yml
services:
  frontend:
    ports:
      - "8081:80"
```

### Container crashes on startup

```bash
# View detailed logs
docker compose logs backend
docker compose logs frontend

# Rebuild without cache
docker compose build --no-cache
```

## Maintenance

### Update images

```bash
# Pull latest base images
docker compose pull

# Rebuild services
docker compose build --pull

# Restart with new images
docker compose up -d
```

### Clean up

```bash
# Stop services
docker compose down

# Remove volumes (be careful!)
docker compose down -v

# Remove images
docker compose down --rmi all
```

## Performance Tuning

### Nginx Configuration
- Gzip compression enabled for text/JSON responses
- Security headers added (X-Frame-Options, X-Content-Type-Options, etc.)
- Cache-Control headers set for static assets

### Backend
- Auto-restart on failure with `restart: unless-stopped`
- Timeout settings in nginx proxy (60s connect/send/read)

## Related Documentation

- [Swazz README](../README.md)
- [Backend Setup](../packages/container/README.md)
- [Frontend Setup](../packages/web/README.md)
