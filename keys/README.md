# Container Image Signature Verification

To ensure that the Docker images for Swazz have not been tampered with in transit or on the registry, we sign all release images using **Cosign**.

The public verification key is stored in this directory as [cosign.pub](file:///Users/alex/.gemini/antigravity/worktrees/swazz/cosign-image-signing-verification/keys/cosign.pub).

## Verification Steps

### 1. Install Cosign
Follow the official [Cosign installation instructions](https://docs.sigstore.dev/cosign/system_config/installation/) for your platform.

On macOS (via Homebrew):
```bash
brew install cosign
```

On Linux:
```bash
LATEST_VERSION=$(curl -sL https://api.github.com/repos/sigstore/cosign/releases/latest | grep '"tag_name":' | cut -d'"' -f4)
curl -O -L "https://github.com/sigstore/cosign/releases/download/${LATEST_VERSION}/cosign-linux-amd64"
chmod +x cosign-linux-amd64
sudo mv cosign-linux-amd64 /usr/local/bin/cosign
```

### 2. Verify the Image
Run the `cosign verify` command, pointing to the public key and the target image tag or digest:

#### Verify the Web Dashboard / API Server Image
```bash
cosign verify --key keys/cosign.pub ghcr.io/sech0us3/swazz:<TAG_OR_DIGEST>
```

#### Verify the CLI Fuzzer Image
```bash
cosign verify --key keys/cosign.pub ghcr.io/sech0us3/swazz-cli:<TAG_OR_DIGEST>
```

### Example Verification Output
When the image signature is valid, you will see output indicating that the claims were verified along with the signature payload:

```json
Verification for ghcr.io/sech0us3/swazz:latest --
The following checks were performed on each of these signatures:
  - The cosign claims were validated
  - The signatures were verified against the specified public key
[{"critical":{"identity":{"docker-reference":"ghcr.io/sech0us3/swazz"},"image":{"docker-manifest-digest":"sha256:..."},"type":"cosign container image signature"},"optional":null}]
```
