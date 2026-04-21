#!/usr/bin/env bash
# Local development startup script
# Prerequisites: Docker, Node.js 20+
# Usage: ./dev.sh

set -e

echo "=== DevOps Demo Store — Local Dev ==="

# 1. Start PostgreSQL
echo ""
echo "[1/4] Starting PostgreSQL via Docker Compose..."
docker compose up -d postgres
echo "Waiting for PostgreSQL to be ready..."
until docker compose exec -T postgres pg_isready -U postgres > /dev/null 2>&1; do
  sleep 1
done
echo "PostgreSQL is ready."

# 2. Export DB env vars for backend services
export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=demo
export DB_USER=postgres
export DB_PASSWORD=postgres
export EBS_MOUNT_PATH=/tmp/ebs-data

# Create fake EBS mount for local dev
mkdir -p "$EBS_MOUNT_PATH"

# 3. Start backend services in background
echo ""
echo "[2/4] Starting Catalog Service on port 3000..."
(cd app/catalog-service && npx tsx src/index.ts) &
CATALOG_PID=$!

echo "[3/4] Starting Orders Service on port 3001..."
(cd app/orders-service && npx tsx src/index.ts) &
ORDERS_PID=$!

# 4. Start frontend dev server
echo ""
echo "[4/4] Starting Frontend on port 5173..."
echo ""
echo "  Frontend:  http://localhost:5173"
echo "  Catalog:   http://localhost:3000/api/catalog/health"
echo "  Orders:    http://localhost:3001/api/orders/health"
echo ""
echo "Press Ctrl+C to stop all services."
echo ""

# Trap Ctrl+C to clean up background processes
cleanup() {
  echo ""
  echo "Shutting down..."
  kill $CATALOG_PID $ORDERS_PID 2>/dev/null || true
  docker compose down
  echo "Done."
}
trap cleanup EXIT INT TERM

(cd app/frontend && npx vite)
