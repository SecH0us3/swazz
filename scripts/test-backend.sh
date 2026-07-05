#!/bin/bash
set -e
cd "$(dirname "$0")/../packages/container"

# Helper function to run commands optionally with rtk wrapper if available
run_cmd() {
    if command -v rtk &> /dev/null; then
        rtk "$@"
    else
        "$@"
    fi
}

echo "======================================"
echo "🔎 Running SAST and Linter checks..."
echo "======================================"

# Run go vet for compiler-like warnings
echo "-> Running go vet..."
run_cmd go vet ./...

# Check and run gosec for SAST
if ! command -v gosec &> /dev/null; then
    echo "-> gosec not found, installing..."
    run_cmd go install github.com/securego/gosec/v2/cmd/gosec@latest
    export PATH="$PATH:$(go env GOPATH)/bin:~/go/bin"
fi

echo "-> Running gosec..."
# Run gosec but exclude test files. We don't fail immediately to still run tests,
# but we capture the exit code.
set +e
run_cmd gosec -exclude-dir=tests -quiet ./...
GOSEC_EXIT=$?
set -e

if [ $GOSEC_EXIT -ne 0 ]; then
    echo "⚠️ SAST issues found by gosec!"
fi

echo "======================================"
echo "🧪 Running unit tests..."
echo "======================================"
run_cmd go test -race ./...

# Return the gosec exit code if tests passed but SAST failed
if [ $GOSEC_EXIT -ne 0 ]; then
    exit $GOSEC_EXIT
fi

