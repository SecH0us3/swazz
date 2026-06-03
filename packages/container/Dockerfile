# === DOCKERFILE FOR CLOUDFLARE CONTAINERS (AMD64 / Linux x64) ===

# Stage 1: Build Go Application
FROM --platform=$BUILDPLATFORM golang:alpine3.23@sha256:91eda9776261207ea25fd06b5b7fed8d397dd2c0a283e77f2ab6e91bfa71079d AS builder
ARG TARGETOS
ARG TARGETARCH
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Security: Build with stripped symbols (-s -w) to reduce size and attack surface
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -ldflags="-s -w" -o swazz-engine .

# Stage 2: Minimal final image
# Security: Using distroless image - no shell, no package manager, minimal attack surface
FROM gcr.io/distroless/static-debian12:nonroot@sha256:a9329520abc449e3b14d5bc3a6ffae065bdde0f02667fa10880c49b35c109fd1
ENV GOMEMLIMIT=230MiB
COPY --from=builder /app/swazz-engine /swazz-engine
WORKDIR /
EXPOSE 8080

# Security: Run as non-root user (uid 65532)
USER nonroot:nonroot

ENTRYPOINT ["/swazz-engine"]
CMD ["serve"]
