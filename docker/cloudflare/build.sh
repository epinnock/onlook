#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Building scry-expo image..."
docker build -t scry-expo:latest -f "$SCRIPT_DIR/expo/Dockerfile" "$SCRIPT_DIR"

echo "Building scry-nextjs image..."
docker build -t scry-nextjs:latest -f "$SCRIPT_DIR/nextjs/Dockerfile" "$SCRIPT_DIR"

echo ""
echo "Images built successfully:"
docker images | grep scry-

# To push to CF Container Registry:
# wrangler containers push scry-expo:latest
# wrangler containers push scry-nextjs:latest
