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

## Running the App

There are two ways to run this project: **locally** (for development, no AWS cost) and the **full AWS deploy** (for the real fault-injection demo). Each has a clear launch and shutdown command.

| Mode              | Launch command          | Shutdown command            | What it gives you                                                           |
|-------------------|-------------------------|-----------------------------|-----------------------------------------------------------------------------|
| 🧪 Local dev      | `./dev.sh`              | Ctrl+C in the terminal      | Browser UI + Postgres in Docker. No EBS, no fault injection, zero AWS cost. |
| ☁️ Full AWS deploy | `./app-up.sh`           | `./app-down.sh --yes`       | Full AWS stack (VPC, ALB, EC2, RDS, EBS, S3, CloudWatch, SNS). ~$50–80/mo.  |

Jump to: [Local dev setup](#local-dev-setup) · [Full AWS deploy](#full-aws-deploy) · [Testing](#running-tests)

---

## Local dev setup

Runs the whole app on your laptop using Docker for Postgres and Node for the services. No AWS account needed, no fault injection (that part requires EBS).

### Prerequisites

- **Node.js 20+**
- **Docker** (for PostgreSQL — `docker compose` must work)

### 1. Install dependencies (one time)

```bash
npm install --prefix app/shared
npm install --prefix app/catalog-service
npm install --prefix app/orders-service
npm install --prefix app/frontend
```

### 2. Start the dev environment

```bash
chmod +x dev.sh     # first time only
./dev.sh
```

`dev.sh` starts:
- PostgreSQL in Docker (port 5432)
- Catalog Service (port 3000)
- Orders Service (port 3001)
- Frontend dev server with hot reload (port 5173)

When it's ready you'll see:

```
  Frontend:  http://localhost:5173
  Catalog:   http://localhost:3000/api/catalog/health
  Orders:    http://localhost:3001/api/orders/health
```

Open **http://localhost:5173** in your browser.

### 3. Stop the dev environment

Press **Ctrl+C** in the terminal running `dev.sh`. The script's cleanup handler will:
- Kill the catalog, orders, and frontend Node processes
- Run `docker compose down` to stop PostgreSQL

If anything gets stuck, run `docker compose down` manually to force-stop Postgres.

### Dev vs prod behavior

The fault-injection trigger item exists locally but won't actually cause a sustained fault — the `fault-inject.sh` script needs a real EBS volume (plus `fio` and `dd` with GNU flags) to degrade the volume meaningfully. Local "fault" demos just return normal responses. Run the full AWS deploy to see the real fault-isolation behavior.

---

## Full AWS deploy

Use this when you want to run the real fault-injection demo on AWS infrastructure. Two scripts wrap Terraform: `app-up.sh` to launch everything and `app-down.sh --yes` to tear it all down with zero leftover resources.

### Prerequisites

- **AWS credentials** configured for account `684394110906` (the scripts refuse to run against any other account)
- **AWS CLI** installed and on `PATH`
- **Terraform** installed (on macOS, `app-up.sh` will auto-install via Homebrew if missing)
- **jq** installed (used by the orphan sweep)

### Launch

```bash
./app-up.sh
```

This runs, in order:
1. **Pre-flight checks** — aws/terraform/jq present, credentials valid, account ID matches `684394110906`
2. **Config bootstrap** — copies `terraform/terraform.tfvars.example` to `terraform/terraform.tfvars` if missing
3. **`terraform init`** — only if `terraform/.terraform/` doesn't exist yet
4. **`terraform plan -detailed-exitcode`** — if no changes needed, prints `No infrastructure changes required.` and exits cleanly
5. **`terraform apply -auto-approve`** — builds/updates the stack
6. **Print outputs** — the ALB DNS, S3 website URL, and SNS topic ARN so you can immediately start using the app

Deploys take ~10-15 minutes end-to-end, mostly RDS provisioning time. Re-running `app-up.sh` after a clean deploy is a no-op (exits cleanly with the "no changes" message).

**Where to access the app after launch:**
- Browse to the `s3_website_url` printed at the end — that's the frontend
- The ALB DNS serves the API under `/api/catalog/*` and `/api/orders/*`

### Shutdown

```bash
./app-down.sh --yes
```

**The `--yes` flag is required.** Without it, the script exits with status 2 and does absolutely nothing — this is the guard against accidental destructive runs.

The shutdown runs:
1. **Pre-flight checks** (same as launch, but no brew auto-install)
2. **Empty the S3 frontend bucket** — handles versioning, deletes in batches of 1000
3. **`terraform destroy -auto-approve`** — tears down every Terraform-managed resource
4. **Orphan sweep** — queries the AWS Resource Groups Tagging API for any resources still tagged `Project=devops-demo` AND `ManagedBy=terraform`, and fails loudly if any remain

Exit code `0` means the stack is fully gone. Exit code `3` means orphans were found — inspect the ARN list on stderr, delete any leftovers manually, then re-run `app-down.sh --yes` (the script is idempotent, safe to re-run).

### Safety model

- **Account guard** — both scripts call `aws sts get-caller-identity` and refuse to run if the account isn't `684394110906`
- **Hardcoded tag filter** — the orphan sweep uses a literal `Key=Project,Values=devops-demo Key=ManagedBy,Values=terraform` string with no variable substitution, so ambient env vars can't widen the scope
- **No direct delete APIs** — the scripts never call `aws ec2 terminate-instances`, `aws rds delete-db-instance`, etc. Every delete flows through `terraform destroy` or S3 object-emptying. A grep-based CI test (`scripts/lib/tag-scope.test.ts`) enforces this mechanically
- **`--yes` is required for destroy** — missing flag always exits 2 before any subprocess spawns

### Exit codes

| Code  | Meaning                                                     |
|-------|-------------------------------------------------------------|
| 0     | Success (deployment complete, or teardown with clean sweep) |
| 1     | Pre-flight check failed, or S3 emptying failed              |
| 2     | Missing `--yes` flag (app-down.sh only)                     |
| 3     | Orphans remain after destroy — see stderr for ARN list      |
| other | Terraform apply/destroy exit code propagated                |

### Estimated cost

~$50–80/month running 24/7. The biggest line items are NAT Gateway, ALB, and RDS. Tear down with `./app-down.sh --yes` as soon as you're done demoing.

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

## AWS Deployment (Manual Terraform)

If you prefer to drive Terraform directly instead of using `app-up.sh` / `app-down.sh`, the full infrastructure is defined under `terraform/`.

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
