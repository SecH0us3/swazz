#!/usr/bin/env bash
set -e

# Set working directory to the project root directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

echo "============================================="
echo "🚀 Running Complete Swazz Verification Suite 🚀"
echo "============================================="

echo ""
echo "📦 Step 1: Running TypeScript Common & Edge Tests..."
npm run test --workspace=packages/edge

echo ""
echo "🐹 Step 2: Running Go Backend Unit & SAST Tests..."
bash scripts/test-backend.sh

echo ""
echo "⚛️ Step 3: Verifying React Web UI Build..."
npm run build

echo ""
echo "🎭 Step 4: Running Playwright E2E Integration Suite..."
bash tests/e2e/run-e2e.sh

echo ""
echo "============================================="
echo "✅ All tests, builds, and E2E suites passed! ✅"
echo "============================================="
