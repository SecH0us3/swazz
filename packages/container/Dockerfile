# === DOCKERFILE FOR CLOUDFLARE CONTAINERS (AMD64 / Linux x64) ===

# Stage 1: Build Go Application
FROM --platform=linux/amd64 golang:alpine3.22@sha256:be93003ee861b3b91b6ebcb22678524947e0cd786c2df3f32af520006b1e54f5 AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags="-s -w" -o swazz-engine .

# Stage 2: Minimal final image
FROM gcr.io/distroless/static-debian12:nonroot@sha256:2ed0144daad224d8f93320dab9af466dddbf0385fb74625ee962b5692cd9d6db
ENV GOMEMLIMIT=230MiB
COPY --from=builder /app/swazz-engine /swazz-engine
WORKDIR /
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/swazz-engine"]
CMD ["serve"]
