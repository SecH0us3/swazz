#!/bin/bash
set -e
cd "$(dirname "$0")/../packages/container"

echo "======================================"
echo "🔎 Running SAST and Linter checks..."
echo "======================================"

# Run go vet for compiler-like warnings
echo "-> Running go vet..."
go vet ./...

# Check and run gosec for SAST
if ! command -v gosec &> /dev/null; then
    echo "-> gosec not found, installing..."
    go install github.com/securego/gosec/v2/cmd/gosec@latest
fi

echo "-> Running gosec..."
# Run gosec but exclude test files. We don't fail immediately to still run tests,
# but we capture the exit code.
set +e
~/go/bin/gosec -exclude-dir=tests -quiet ./...
GOSEC_EXIT=$?
set -e

if [ $GOSEC_EXIT -ne 0 ]; then
    echo "⚠️ SAST issues found by gosec!"
fi

echo "======================================"
echo "🧪 Running unit tests..."
echo "======================================"
go test -race ./...

# Return the gosec exit code if tests passed but SAST failed
if [ $GOSEC_EXIT -ne 0 ]; then
    exit $GOSEC_EXIT
fi
