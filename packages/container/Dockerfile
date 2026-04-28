# === DOCKERFILE FOR CLOUDFLARE CONTAINERS (AMD64 / Linux x64) ===

# Stage 1: Build Go Application
FROM --platform=linux/amd64 golang:alpine3.22 AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o swazz-engine main.go

# Stage 2: Minimal final image
FROM --platform=linux/amd64 alpine:latest
RUN apk add --no-cache ca-certificates
COPY --from=builder /app/swazz-engine /usr/local/bin/swazz-engine
WORKDIR /app
EXPOSE 8080
CMD ["swazz-engine", "serve"]
