#!/bin/bash
set -e
cd "$(dirname "$0")/../packages/container"
go test ./...
