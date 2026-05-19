# === DOCKERFILE FOR CLOUDFLARE CONTAINERS (AMD64 / Linux x64) ===

# Stage 1: Build Go Application
FROM --platform=linux/amd64 golang:alpine3.22@sha256:7ef94116875d0aa8799133184ed57cf79ff24bdefe8c8820470602a9d3d6d9192b8 AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o swazz-engine .

# Stage 2: Minimal final image
FROM gcr.io/distroless/static-debian12:nonroot@sha256:a9329520abc449e3b14d5bc3a6ffae065bdde0f02667fa10880c49b35c109fd1
ENV GOMEMLIMIT=230MiB
COPY --from=builder /app/swazz-engine /swazz-engine
WORKDIR /
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/swazz-engine"]
CMD ["serve"]
