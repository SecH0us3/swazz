#!/bin/bash
# run-coverage.sh
# Runs Go backend coverage and Vitest frontend coverage, printing only the summaries
# to minimize token consumption.

set -e

echo "=== Go Backend Coverage ==="
cd packages/container
go test -coverprofile=coverage.out ./... > /dev/null 2>&1 || true
if [ -f coverage.out ]; then
    go tool cover -func=coverage.out | grep total
else
    echo "Go coverage.out not generated."
fi
cd ../..

echo ""
echo "=== React Frontend Coverage ==="
cd packages/web
# Run vitest coverage and filter to show only the overall totals table
npx vitest run --coverage --reporter=default | grep -E "All files|-------------------|File               \|" || true
cd ../..
