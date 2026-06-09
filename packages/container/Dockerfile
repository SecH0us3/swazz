# === DOCKERFILE FOR CLOUDFLARE CONTAINERS (AMD64 / Linux x64) ===

# Stage 1: Build Go Application
FROM --platform=$BUILDPLATFORM golang:alpine3.23@sha256:f23e8b227fb4493eabe03bede4d5a32d04092da71962f1fb79b5f7d1e6c2a17f AS builder
ARG TARGETOS
ARG TARGETARCH
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Security: Build with stripped symbols (-s -w) to reduce size and attack surface
ARG DOCKER_TAG=dev
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -ldflags="-s -w -X main.Version=${DOCKER_TAG}" -o swazz-engine .

# Stage 2: Minimal final image
# Security: Using distroless image - no shell, no package manager, minimal attack surface
FROM gcr.io/distroless/static-debian12:nonroot@sha256:a9329520abc449e3b14d5bc3a6ffae065bdde0f02667fa10880c49b35c109fd1
ENV GOMEMLIMIT=230MiB
COPY --from=builder /app/swazz-engine /swazz-engine
COPY --from=builder /app/web/dist /web/dist
WORKDIR /
EXPOSE 8080

# Security: Run as non-root user (uid 65532)
USER nonroot:nonroot

ENTRYPOINT ["/swazz-engine"]
CMD ["serve"]
