#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Deploy backend services to EC2 via S3
# Builds TypeScript, packages each service with its dependencies and shared
# code, uploads tarballs to the frontend S3 bucket under /deploy/, then
# triggers EC2 instance replacement so fresh user-data runs.
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TF_DIR="$ROOT_DIR/terraform"

# Read Terraform outputs
S3_BUCKET=$(cd "$TF_DIR" && terraform output -raw s3_bucket_name)
AWS_REGION=$(cd "$TF_DIR" && terraform output -raw aws_region 2>/dev/null || echo "us-east-1")

echo "==> Deploying services to s3://$S3_BUCKET/deploy/"

# ---------------------------------------------------------------------------
# Build services
# ---------------------------------------------------------------------------
echo "==> Building catalog-service..."
(cd "$ROOT_DIR/app/catalog-service" && npm run build)

echo "==> Building orders-service..."
(cd "$ROOT_DIR/app/orders-service" && npm run build)

# ---------------------------------------------------------------------------
# Package catalog-service
# ---------------------------------------------------------------------------
echo "==> Packaging catalog-service..."
CATALOG_STAGE=$(mktemp -d)
# Copy built JS (flatten the extra directory level from rootDir: "..")
mkdir -p "$CATALOG_STAGE/dist/src"
cp "$ROOT_DIR/app/catalog-service/dist/catalog-service/src/"*.js "$CATALOG_STAGE/dist/src/"
mkdir -p "$CATALOG_STAGE/dist/shared"
cp "$ROOT_DIR/app/catalog-service/dist/shared/"*.js "$CATALOG_STAGE/dist/shared/"
# Copy package files
cp "$ROOT_DIR/app/catalog-service/package.json" "$CATALOG_STAGE/"
cp "$ROOT_DIR/app/catalog-service/package-lock.json" "$CATALOG_STAGE/"
# Copy shared DB scripts
mkdir -p "$CATALOG_STAGE/db"
cp "$ROOT_DIR/app/shared/db/init.sql" "$CATALOG_STAGE/db/"
cp "$ROOT_DIR/app/shared/db/seed.sql" "$CATALOG_STAGE/db/"

tar -czf /tmp/catalog-service.tar.gz -C "$CATALOG_STAGE" .
rm -rf "$CATALOG_STAGE"

# ---------------------------------------------------------------------------
# Package orders-service
# ---------------------------------------------------------------------------
echo "==> Packaging orders-service..."
ORDERS_STAGE=$(mktemp -d)
# Copy built JS (flatten the extra directory level)
mkdir -p "$ORDERS_STAGE/dist/src"
cp "$ROOT_DIR/app/orders-service/dist/orders-service/src/"*.js "$ORDERS_STAGE/dist/src/"
mkdir -p "$ORDERS_STAGE/dist/shared"
cp "$ROOT_DIR/app/orders-service/dist/shared/"*.js "$ORDERS_STAGE/dist/shared/"
# Copy package files
cp "$ROOT_DIR/app/orders-service/package.json" "$ORDERS_STAGE/"
cp "$ROOT_DIR/app/orders-service/package-lock.json" "$ORDERS_STAGE/"
# Copy fault injection scripts
mkdir -p "$ORDERS_STAGE/scripts"
cp "$ROOT_DIR/app/orders-service/scripts/"*.sh "$ORDERS_STAGE/scripts/"

tar -czf /tmp/orders-service.tar.gz -C "$ORDERS_STAGE" .
rm -rf "$ORDERS_STAGE"

# ---------------------------------------------------------------------------
# Upload to S3
# ---------------------------------------------------------------------------
echo "==> Uploading to S3..."
aws s3 cp /tmp/catalog-service.tar.gz "s3://$S3_BUCKET/deploy/catalog-service.tar.gz" --region "$AWS_REGION"
aws s3 cp /tmp/orders-service.tar.gz "s3://$S3_BUCKET/deploy/orders-service.tar.gz" --region "$AWS_REGION"
rm -f /tmp/catalog-service.tar.gz /tmp/orders-service.tar.gz

echo "==> Upload complete."
echo ""
echo "Artifacts:"
aws s3 ls "s3://$S3_BUCKET/deploy/" --region "$AWS_REGION"
echo ""
echo "To deploy to EC2, run: cd terraform && terraform apply -replace=aws_instance.catalog -replace=aws_instance.orders"
