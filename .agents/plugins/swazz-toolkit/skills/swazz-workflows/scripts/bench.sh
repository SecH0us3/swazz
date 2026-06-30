#!/usr/bin/env bash
echo "Running swazz engine benchmarks..."
cd packages/container && go test -bench . -benchmem -timeout 60s
