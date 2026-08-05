#!/usr/bin/env bash
set -euo pipefail

echo "==> Building frontend (Vite)..."
BASE_PATH=/ PORT=5173 NODE_ENV=production \
  pnpm --filter @workspace/screener exec vite build --config vite.config.ts

echo "==> Building API server (esbuild)..."
pnpm --filter @workspace/api-server run build

echo "==> Build complete."
