# 🛒 DevOps Agent Demo Store

A purpose-built e-commerce demo environment that showcases **localized failure isolation** on AWS. Buy a special "Mystery Box of Chaos" and watch the Orders Service crumble while the Catalog Service keeps humming along — exactly the kind of scenario a DevOps agent would investigate.

## What It Does

This project deploys a small microservices platform with a hidden superpower: **on-demand fault injection**.

1. **Browse products** — a normal e-commerce catalog powered by the Catalog Service
2. **Buy the trigger item** — purchasing the "Mystery Box of Chaos" kicks off EBS volume degradation on the Orders Service
3. **Watch it break** — subsequent orders fail with HTTP 500s, latency spikes, and CloudWatch alarms fire
4. **Catalog stays healthy** — the Catalog Service is completely unaffected (fault isolation in action)
5. **Reset and repeat** — one click clears the fault and restores everything for the next demo

CloudWatch alarms detect the degradation and publish to an SNS topic, ready for a downstream DevOps agent to pick up and investigate.

## Architecture

```
┌─────────────┐
│   Browser    │
└──────┬──────┘
       │
┌──────▼──────┐     ┌──────────────────┐     ┌─────────────┐
│     ALB      │────▶│  Catalog Service  │────▶│             │
│  (routing)   │     │   (port 3000)    │     │     RDS     │
│              │     └──────────────────┘     │  PostgreSQL │
│              │     ┌──────────────────┐     │             │
│              │────▶│  Orders Service   │────▶│             │
└──────────────┘     │   (port 3001)    │     └─────────────┘
                     │   + EBS Volume   │
                     │   (fault target) │
                     └──────────────────┘
                              │
                     ┌────────▼────────┐
                     │   CloudWatch    │──▶ SNS Topic
                     │   (3 alarms)    │
                     └─────────────────┘
```

**Services:**
- **Catalog Service** — serves product data from RDS. No EBS dependency, stays healthy during faults.
- **Orders Service** — handles checkout, writes order logs to a dedicated EBS volume. This is the fault target.
- **Frontend** — vanilla TypeScript UI hosted on S3 (or Vite dev server locally).

## Quick Start (Local Development)

### Prerequisites

- **Node.js 20+**
- **Docker** (for PostgreSQL)

### 1. Install dependencies

```bash
# Install each service's dependencies
npm install --prefix app/shared
npm install --prefix app/catalog-service
npm install --prefix app/orders-service
npm install --prefix app/frontend
```

### 2. Run everything

```bash
chmod +x dev.sh
./dev.sh
```

This starts PostgreSQL in Docker, both backend services, and the frontend dev server. You'll see:

```
  Frontend:  http://localhost:5173
  Catalog:   http://localhost:3000/api/catalog/health
  Orders:    http://localhost:3001/api/orders/health
```

### 3. Open the app

Go to **http://localhost:5173** in your browser.

### 4. Try the fault injection

1. Click **"Buy"** on the **Mystery Box of Chaos** (the red/special item)
2. Try buying any other product — it will fail with a 500 error
3. Click **"Reset Fault"** to clear the fault and restore normal operation

Press **Ctrl+C** in the terminal to stop everything.

## Running Tests

```bash
# Run all backend tests
npm test

# Run catalog service tests only
npm run test:catalog

# Run orders service tests only
npm run test:orders
```

Tests include unit tests and property-based tests (using fast-check) that validate correctness properties like fault isolation, checkout validation, and health check accuracy.

## AWS Deployment (Terraform)

The full AWS infrastructure is defined in Terraform under the `terraform/` directory.

### Prerequisites

- **Terraform >= 1.5**
- **AWS CLI** configured with appropriate credentials

### Deploy

```bash
cd terraform

# Copy and edit variables
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your values

# Initialize and deploy
terraform init
terraform plan
terraform apply
```

### What Gets Created

| Resource | Purpose |
|----------|---------|
| VPC + Subnets | Private networking (EC2 in private subnets, ALB in public) |
| ALB | Routes `/api/catalog/*` and `/api/orders/*` to the right service |
| 2x EC2 (t3.micro) | Catalog Service + Orders Service |
| EBS Volume (gp3, 20GB) | Attached to Orders EC2 — the fault injection target |
| RDS PostgreSQL (db.t3.micro) | Product and order data |
| S3 Bucket | Static frontend hosting |
| CloudWatch Alarms (3) | EBS queue length, ALB 5XX count, API latency |
| SNS Topic | Receives alarm state changes for downstream consumption |
| Secrets Manager | Stores RDS credentials |
| IAM Roles | Least-privilege EC2 instance profiles |

### Estimated Cost

~$50–80/month running 24/7. Stop instances when not demoing to save costs.

### Tear Down

```bash
cd terraform
terraform destroy
```

## Project Structure

```
├── app/
│   ├── shared/              # Shared types and database schema
│   │   ├── types.ts         # Product, Order, HealthCheck, etc.
│   │   └── db/
│   │       ├── init.sql     # Table definitions
│   │       └── seed.sql     # Trigger item + sample products
│   ├── catalog-service/     # Express.js — product catalog API
│   │   └── src/
│   │       ├── index.ts     # App entry point (port 3000)
│   │       ├── routes.ts    # GET /api/catalog/items, health
│   │       └── db.ts        # PostgreSQL connection pool
│   ├── orders-service/      # Express.js — checkout + fault injection
│   │   ├── src/
│   │   │   ├── index.ts     # App entry point (port 3001)
│   │   │   ├── routes.ts    # POST checkout, GET order, POST reset
│   │   │   ├── health.ts    # Health check (DB + EBS)
│   │   │   ├── fault-inject.ts  # Fault injection/reset/status
│   │   │   └── order-log.ts # EBS-dependent order logging
│   │   └── scripts/
│   │       ├── fault-inject.sh  # fio + dd stress script
│   │       └── fault-reset.sh   # Kill processes, clean up
│   └── frontend/            # Vanilla TypeScript UI (Vite)
│       └── src/
│           ├── main.ts      # Product grid, buy/reset handlers
│           ├── api.ts       # API client (catalog, orders, reset)
│           └── styles.css   # Responsive layout
├── terraform/               # Full AWS infrastructure
│   ├── main.tf              # Provider config
│   ├── vpc.tf               # VPC, subnets, NAT
│   ├── security-groups.tf   # Least-privilege SGs
│   ├── alb.tf               # ALB + target groups + routing
│   ├── ec2-catalog.tf       # Catalog EC2 instance
│   ├── ec2-orders.tf        # Orders EC2 + EBS volume
│   ├── rds.tf               # PostgreSQL RDS
│   ├── cloudwatch.tf        # 3 alarms + dashboard
│   ├── sns.tf               # Alarm notification topic
│   ├── s3-frontend.tf       # Static website hosting
│   ├── iam.tf               # Instance profiles
│   ├── secrets.tf           # RDS credentials
│   └── variables.tf         # Configurable inputs
├── docker-compose.yml       # Local PostgreSQL
├── dev.sh                   # One-command local dev startup
└── package.json             # Root scripts (test, build, lint)
```

## API Reference

### Catalog Service (port 3000)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/catalog/items` | List all products |
| GET | `/api/catalog/items/:id` | Get product by ID |
| GET | `/api/catalog/health` | Health check |

### Orders Service (port 3001)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/orders/checkout` | Place an order (`{ itemId, quantity }`) |
| GET | `/api/orders/:id` | Get order by ID |
| GET | `/api/orders/health` | Health check (DB + EBS) |
| POST | `/api/orders/reset` | Clear fault injection |

## How the Fault Injection Works

1. **Trigger**: Buying the product with ID `TRIGGER_ITEM` calls `fault-inject.sh`
2. **fio**: Launches 8 parallel random-write jobs at 4K block size with iodepth 64 — exhausts the EBS volume's IOPS
3. **dd**: Simultaneously fills the disk with zeros
4. **Marker**: Creates a `.fault-active` file so the system knows a fault is active (and won't stack multiple faults)
5. **Impact**: Any Orders Service operation that touches the EBS volume (order log writes, health checks) will timeout or fail
6. **Detection**: CloudWatch picks up the spike in `VolumeQueueLength`, ALB 5XX count, and response latency
7. **Reset**: `POST /api/orders/reset` kills the fio/dd processes, removes stress files, and clears the marker

## License

Internal demo project — not intended for production use.
