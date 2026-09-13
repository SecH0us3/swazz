# === DOCKERFILE FOR CLOUDFLARE CONTAINERS (AMD64 / Linux x64) ===

# Stage 1: Build Go Application
FROM --platform=$BUILDPLATFORM golang:1.26.6-alpine3.23@sha256:e57c41c1d5864341031181b0db34b9a537bb5773eb6428e4e5bdaea0f9135406 AS builder
ARG TARGETOS
ARG TARGETARCH
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# Security: Build with stripped symbols (-s -w) to reduce size and attack surface
ARG DOCKER_TAG=dev
# Enterprise license trust anchor: the Ed25519 public key (64-char hex) this
# binary verifies license JWTs against. Empty by default, so ad-hoc builds trust
# no key at all and stay in community mode; release builds MUST pass the
# production public key (same value as the edge worker's SWAZZ_LICENSE_PUBKEY)
# so that dashboard-issued licenses verify offline.
ARG LICENSE_PUBKEY_HEX=""
RUN set -e; \
    if [ -n "${LICENSE_PUBKEY_HEX}" ] && ! printf '%s' "${LICENSE_PUBKEY_HEX}" | grep -Eq '^[0-9a-fA-F]{64}$'; then \
      echo "ERROR: LICENSE_PUBKEY_HEX must be a 64-character hex Ed25519 public key" >&2; \
      exit 1; \
    fi; \
    LDFLAGS="-s -w -X main.Version=${DOCKER_TAG}"; \
    if [ -n "${LICENSE_PUBKEY_HEX}" ]; then \
      LDFLAGS="${LDFLAGS} -X swazz-engine/internal/license.DefaultPublicKeyHex=${LICENSE_PUBKEY_HEX}"; \
    fi; \
    CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -ldflags="${LDFLAGS}" -o swazz-engine .

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
CMD ["run-agent"]
