# Implementation Plan: DevOps Agent Demo Environment

## Overview

This plan implements an AWS-based demo environment for a dummy e-commerce platform with two backend services (Catalog and Orders), an S3-hosted frontend, RDS PostgreSQL database, and a fault injection mechanism targeting an EBS volume. Infrastructure is defined in Terraform; application code is TypeScript/Express. The implementation proceeds bottom-up: shared types → infrastructure → backend services → fault injection → observability → frontend → integration wiring.

## Tasks

- [x] 1. Set up project structure and shared types
  - [x] 1.1 Create directory structure and initialize packages
    - Create `app/shared/`, `app/catalog-service/`, `app/orders-service/`, `app/frontend/`, and `terraform/` directories
    - Initialize `package.json` and `tsconfig.json` for each service with TypeScript strict mode
    - Install dependencies: `express`, `pg`, `uuid` for backend services; `vite` for frontend
    - Install dev dependencies: `vitest`, `@types/express`, `@types/pg`, `typescript`
    - _Requirements: 9.1_

  - [x] 1.2 Define shared type interfaces
    - Create `app/shared/types.ts` with `Product`, `Order`, `OrderStatus`, `CheckoutRequest`, `CheckoutResponse`, `HealthCheck`, `FaultStatus`, `ResetResponse`, and `AlarmConfig` interfaces as specified in the design data models
    - Export all types for consumption by both backend services and frontend
    - _Requirements: 1.1, 2.1, 6.1_

  - [x] 1.3 Write unit tests for shared types
    - Verify all interfaces are importable from the shared module
    - Validate type guard functions (if implemented) for `OrderStatus` and `HealthCheck` status values
    - _Requirements: 1.1, 2.1_

- [x] 2. Implement Terraform networking and security foundation
  - [x] 2.1 Create Terraform provider configuration and variables
    - Create `terraform/main.tf` with AWS provider configuration (>= 5.0) and required Terraform version (>= 1.5)
    - Create `terraform/variables.tf` with input variables: `aws_region`, `project_name`, `db_username`, `vpc_cidr`, `environment`
    - Create `terraform/outputs.tf` with outputs for ALB DNS name, S3 website URL, RDS endpoint, SNS topic ARN
    - Create `terraform/terraform.tfvars.example` with example values
    - _Requirements: 9.1_

  - [x] 2.2 Create VPC and networking resources
    - Create `terraform/vpc.tf` with VPC (10.0.0.0/16), 2 public subnets (10.0.1.0/24, 10.0.2.0/24), 2 private subnets (10.0.10.0/24, 10.0.11.0/24)
    - Configure Internet Gateway, NAT Gateway in public subnet, route tables for public and private subnets
    - _Requirements: 9.1, 9.2_

  - [x] 2.3 Create security groups with least-privilege rules
    - Create `terraform/security-groups.tf` with: ALB SG (inbound 80/443 from 0.0.0.0/0), EC2 SG (inbound app port from ALB SG only), RDS SG (inbound 5432 from EC2 SG only)
    - _Requirements: 9.3_

- [x] 3. Implement Terraform data layer and IAM
  - [x] 3.1 Create IAM roles and instance profiles
    - Create `terraform/iam.tf` with EC2 instance role, instance profile, and policies for CloudWatch metrics publishing and SSM Session Manager access
    - _Requirements: 9.4_

  - [x] 3.2 Create Secrets Manager for RDS credentials
    - Create `terraform/secrets.tf` with a Secrets Manager secret for RDS username/password
    - Generate a random password using `random_password` resource
    - _Requirements: 9.5_

  - [x] 3.3 Create RDS PostgreSQL instance
    - Create `terraform/rds.tf` with `db.t3.micro` PostgreSQL 15 instance in private subnet
    - Configure: not publicly accessible, encrypted at rest, credentials from Secrets Manager, DB subnet group across private subnets
    - _Requirements: 9.6, 12.1, 12.2_

- [x] 4. Checkpoint — Verify Terraform foundation
  - Ensure `terraform validate` passes for all files created so far, ask the user if questions arise.

- [x] 5. Implement Terraform compute and load balancing
  - [x] 5.1 Create ALB with target groups and routing rules
    - Create `terraform/alb.tf` with ALB in public subnets, HTTP listener on port 80
    - Create Catalog target group with health check on `/api/catalog/health`
    - Create Orders target group with health check on `/api/orders/health`
    - Add listener rules: `/api/catalog/*` → Catalog TG, `/api/orders/*` → Orders TG
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 5.2 Create Catalog Service EC2 instance
    - Create `terraform/ec2-catalog.tf` with `t3.micro` in private subnet, IAM instance profile, EC2 SG
    - Write user data script to install Node.js 20, clone/deploy catalog service, start with PM2 or systemd
    - Enable detailed monitoring (1-minute intervals)
    - _Requirements: 9.1, 9.2, 9.4, 7.6_

  - [x] 5.3 Create Orders Service EC2 instance with dedicated EBS volume
    - Create `terraform/ec2-orders.tf` with `t3.micro` in private subnet, IAM instance profile, EC2 SG
    - Attach a dedicated gp3 20GB EBS volume (separate from root), mount at `/mnt/ebs-data`
    - Write user data script to install Node.js 20, `fio`, format/mount EBS volume, deploy orders service
    - Enable detailed monitoring (1-minute intervals)
    - _Requirements: 9.7, 9.2, 9.4, 7.6_

  - [x] 5.4 Create S3 static website hosting for frontend
    - Create `terraform/s3-frontend.tf` with S3 bucket configured for static website hosting
    - Configure bucket policy for public read access, set index.html as default document
    - _Requirements: 9.1, 10.1_

- [x] 6. Implement Terraform observability stack
  - [x] 6.1 Create SNS topic for alarm notifications
    - Create `terraform/sns.tf` with SNS topic for CloudWatch alarm state changes
    - Output the topic ARN for downstream consumption
    - _Requirements: 7.4, 7.5_

  - [x] 6.2 Create CloudWatch alarms and dashboard
    - Create `terraform/cloudwatch.tf` with three alarms:
      - EBS Bottleneck: `VolumeQueueLength` exceeds threshold (e.g., > 10 for 2 consecutive 1-min periods)
      - 5XX Spike: ALB `HTTPCode_Target_5XX_Count` exceeds threshold (e.g., > 5 in 1-min period)
      - Latency Spike: ALB `TargetResponseTime` exceeds threshold (e.g., > 3s average over 2 periods)
    - Configure all alarms to publish to SNS topic on both ALARM and OK transitions
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 7. Checkpoint — Verify complete Terraform configuration
  - Run `terraform validate` and `terraform fmt` on all Terraform files, ensure no errors. Ask the user if questions arise.

- [x] 8. Implement Catalog Service
  - [x] 8.1 Create database connection module
    - Create `app/catalog-service/src/db.ts` with PostgreSQL connection pool using `pg`
    - Read connection parameters from environment variables (host, port, database, credentials from Secrets Manager)
    - Implement connection retry with exponential backoff
    - _Requirements: 13.2_

  - [x] 8.2 Implement Catalog Service route handlers
    - Create `app/catalog-service/src/routes.ts` with Express router:
      - `GET /api/catalog/items` — query all products from RDS, return JSON array with HTTP 200
      - `GET /api/catalog/items/:id` — query single product by ID, return HTTP 200 or HTTP 404 with descriptive error
      - `GET /api/catalog/health` — verify DB connectivity, return health status
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 6.4_

  - [x] 8.3 Create Catalog Service Express app entry point
    - Create `app/catalog-service/src/index.ts` with Express app setup, JSON body parsing, CORS headers, error handling middleware
    - Mount catalog routes, start server on configurable port
    - _Requirements: 1.1, 13.2_

  - [x] 8.4 Write property tests for Catalog Service
    - **Property 1: Catalog retrieval returns all stored products**
    - For any set of products in the database, `GET /api/catalog/items` returns every product with HTTP 200, and `GET /api/catalog/items/:id` returns the exact product
    - Use fast-check to generate arbitrary product sets and verify completeness
    - **Validates: Requirements 1.1, 1.2**

  - [x] 8.5 Write unit tests for Catalog Service routes
    - Test `GET /api/catalog/items` returns product array with HTTP 200
    - Test `GET /api/catalog/items/:id` returns single product with HTTP 200
    - Test `GET /api/catalog/items/:id` returns HTTP 404 for non-existent ID
    - Test `GET /api/catalog/health` returns healthy status when DB is connected
    - Test `GET /api/catalog/health` returns unhealthy status when DB is unreachable
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 6.4_

- [x] 9. Implement Orders Service core checkout logic
  - [x] 9.1 Create database connection module for Orders Service
    - Create `app/orders-service/src/db.ts` with PostgreSQL connection pool using `pg`
    - Read connection parameters from environment variables
    - Implement connection retry with exponential backoff
    - _Requirements: 13.2_

  - [x] 9.2 Implement order log writer (EBS dependency)
    - Create `app/orders-service/src/order-log.ts` with `writeOrderLog()` function
    - Append order details (ID, product ID, timestamp, status) to `${EBS_MOUNT_PATH}/orders.log`
    - Throw `EbsWriteError` custom error on I/O failure with timeout handling
    - _Requirements: 2.4, 13.1_

  - [x] 9.3 Implement checkout route handler
    - Create `app/orders-service/src/routes.ts` with Express router:
      - `POST /api/orders/checkout` — validate input (reject empty itemId or non-positive quantity with HTTP 400), look up product (HTTP 404 if not found), create order record, write order log to EBS, detect trigger item and execute fault injection, confirm non-trigger orders
      - `GET /api/orders/:id` — return order by ID
    - Implement per Algorithm 1 from design: validate → lookup → create → write log → check trigger → confirm
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 11.3_

  - [x] 9.4 Write property tests for checkout validation
    - **Property 2: Valid checkout creates a confirmed order**
    - For any valid checkout request (non-empty itemId referencing existing non-trigger product, positive quantity), verify order is created with status "confirmed" and HTTP 200
    - **Validates: Requirements 2.1, 2.5**

  - [x] 9.5 Write property tests for invalid checkout rejection
    - **Property 3: Invalid checkout requests are rejected**
    - For any checkout request with empty/whitespace itemId or zero/negative quantity, verify HTTP 400 and no order record created
    - Use fast-check to generate arbitrary invalid inputs
    - **Validates: Requirement 2.2**

  - [x] 9.6 Write unit tests for Orders Service checkout
    - Test valid checkout creates order and returns HTTP 200 with orderId
    - Test empty itemId returns HTTP 400
    - Test non-positive quantity returns HTTP 400
    - Test non-existent product returns HTTP 404
    - Test trigger item checkout sets `faultInjected: true`
    - Test non-trigger order status is updated to "confirmed"
    - Test EBS write failure returns HTTP 500 with "EBS_IO_TIMEOUT" error code
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 3.1, 3.2, 13.1_

- [x] 10. Implement fault injection mechanism
  - [x] 10.1 Create fault injection shell scripts
    - Create `app/orders-service/scripts/fault-inject.sh` — launches `fio` (8 jobs, iodepth 64, random 4K writes) and `dd` (fill disk) as background processes, creates `.fault-active` marker
    - Create `app/orders-service/scripts/fault-reset.sh` — kills fio/dd processes, removes stress files and marker
    - _Requirements: 3.4, 3.5, 3.6, 5.1, 5.2, 5.3, 5.4_

  - [x] 10.2 Implement fault injection TypeScript module
    - Create `app/orders-service/src/fault-inject.ts` with:
      - `executeFaultInjection(mountPath)` — check if fault already active (idempotent), exec fault-inject.sh
      - `resetFault(mountPath)` — exec fault-reset.sh, return disk usage
      - `getFaultStatus(mountPath)` — check `.fault-active` marker and `pgrep fio`, return `FaultStatus`
    - Implement per Algorithms 2 and 3 from design
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 10.3 Implement fault reset route handler
    - Add `POST /api/orders/reset` to Orders Service routes
    - Call `resetFault()`, return response with disk usage percentage
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 10.4 Write property test for fault injection idempotency
    - **Property 4: Fault injection is idempotent**
    - For any number of consecutive calls to `executeFaultInjection` while fault is active, verify exactly one set of fio/dd processes running
    - Mock shell execution and verify single invocation
    - **Validates: Requirement 3.3**

  - [x] 10.5 Write unit tests for fault injection and reset
    - Test `executeFaultInjection` creates marker file and launches processes
    - Test `executeFaultInjection` skips when fault already active (idempotent)
    - Test `resetFault` kills processes, removes files, returns disk usage
    - Test `getFaultStatus` returns correct active/inactive state
    - Test fault injection gracefully handles missing `fio` binary (logs error, returns `faultInjected: false`)
    - _Requirements: 3.3, 3.4, 3.5, 3.6, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 13.3_

- [x] 11. Implement health check system
  - [x] 11.1 Implement Orders Service health check
    - Create `app/orders-service/src/health.ts` with `checkOrdersHealth(mountPath)` function
    - Implement per Algorithm 4: check DB connectivity (SELECT 1), check EBS I/O (write/read/delete test file with 5s timeout)
    - Return "healthy" (both OK), "degraded" (DB OK, EBS slow/failing), "unhealthy" (DB unreachable)
    - Clean up test file after check completes
    - _Requirements: 6.1, 6.2, 6.3, 6.5_

  - [x] 11.2 Add health check route to Orders Service
    - Add `GET /api/orders/health` route that calls `checkOrdersHealth()` and returns the `HealthCheck` response
    - _Requirements: 6.1, 6.2, 6.3_

  - [x] 11.3 Create Orders Service Express app entry point
    - Create `app/orders-service/src/index.ts` with Express app setup, JSON body parsing, CORS headers
    - Mount orders routes (checkout, get order, health, reset), error handling middleware for EBS timeouts and DB errors
    - _Requirements: 13.1, 13.2, 13.4_

  - [x] 11.4 Write property test for health check accuracy
    - **Property 7: Health check accuracy reflects system state**
    - For any combination of DB connectivity and EBS I/O latency, verify correct status: "healthy" (both responsive, EBS < 5s), "degraded" (DB up, EBS > 5s), "unhealthy" (DB unreachable)
    - **Validates: Requirements 6.1, 6.2**

  - [x] 11.5 Write property test for health check cleanup
    - **Property 8: Health check leaves no residual files**
    - For any invocation of the health check, verify no test files remain on the EBS volume after completion
    - **Validates: Requirement 6.5**

  - [x] 11.6 Write unit tests for health check
    - Test returns "healthy" when DB and EBS both responsive
    - Test returns "degraded" when DB up but EBS I/O exceeds 5s
    - Test returns "unhealthy" when DB unreachable
    - Test cleans up health check test file after execution
    - _Requirements: 6.1, 6.2, 6.3, 6.5_

- [x] 12. Checkpoint — Verify backend services
  - Ensure all tests pass for catalog-service and orders-service (`npm test -- --run` in each service directory). Ask the user if questions arise.

- [x] 13. Implement database schema and seed data
  - [x] 13.1 Create database initialization SQL
    - Create `app/shared/db/init.sql` with:
      - `products` table: id, name, description, price (CHECK > 0), image_url, category, is_trigger
      - `orders` table: id, product_id (FK → products), quantity (CHECK > 0), total_price, status, created_at
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [x] 13.2 Create seed data SQL
    - Create `app/shared/db/seed.sql` with:
      - Trigger item: id "TRIGGER_ITEM", name "Mystery Box of Chaos", is_trigger true
      - At least 3-4 normal products with varied categories and prices
    - _Requirements: 12.5_

  - [x] 13.3 Write property test for database constraints
    - **Property 10: Database constraints enforce positive values**
    - For any product with non-positive price or order with non-positive quantity, verify the database rejects the insert via CHECK constraints
    - **Validates: Requirements 12.3, 12.4**

- [x] 14. Implement frontend UI
  - [x] 14.1 Create frontend project with Vite
    - Create `app/frontend/package.json` and `app/frontend/vite.config.ts`
    - Create `app/frontend/src/index.html` with basic HTML structure, product grid container, and reset button
    - Create `app/frontend/src/styles.css` with responsive product grid layout and error/success state styles
    - _Requirements: 10.1_

  - [x] 14.2 Implement API client module
    - Create `app/frontend/src/api.ts` with functions:
      - `getItems()` — fetch `GET /api/catalog/items` from ALB
      - `checkout(itemId, quantity)` — fetch `POST /api/orders/checkout` via ALB
      - `resetFault()` — fetch `POST /api/orders/reset` via ALB
    - Configure base URL from environment variable (ALB DNS)
    - _Requirements: 10.1, 10.2, 10.5_

  - [x] 14.3 Implement frontend main application logic
    - Create `app/frontend/src/main.ts` with:
      - On load: fetch and render product grid from Catalog API
      - Buy button click: send checkout request, display success (order confirmation with status) or error (HTTP 500 state)
      - Reset button click: send reset request, display confirmation
      - Visual distinction for the trigger item in the product grid
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 14.4 Write unit tests for API client
    - Test `getItems()` returns product array on success
    - Test `checkout()` sends correct POST body and handles success/error responses
    - Test `resetFault()` sends POST and handles response
    - _Requirements: 10.1, 10.2, 10.5_

- [x] 15. Wire integration and error handling
  - [x] 15.1 Implement error handling middleware for Orders Service
    - Add Express error handling middleware to catch `EbsWriteError` → HTTP 500 with `{ error: "Service temporarily unavailable", code: "EBS_IO_TIMEOUT" }`
    - Handle DB connection errors → HTTP 503 with `{ error: "Database unavailable", code: "DB_CONNECTION_ERROR" }`
    - Handle fault injection script failures → log error, return HTTP 200 with `faultInjected: false` and warning
    - Log all errors with context (operation, relevant IDs)
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [x] 15.2 Implement error handling middleware for Catalog Service
    - Add Express error handling middleware for DB connection errors → HTTP 503 with `DB_CONNECTION_ERROR`
    - Log errors with context
    - _Requirements: 13.2, 13.4_

  - [x] 15.3 Wire EC2 user data scripts for service deployment
    - Update `terraform/ec2-catalog.tf` user data to: install Node.js 20, copy catalog-service code, install dependencies, run DB init/seed SQL, start service
    - Update `terraform/ec2-orders.tf` user data to: install Node.js 20, install `fio`, format/mount EBS volume, copy orders-service code, install dependencies, start service
    - Pass environment variables (DB host, credentials from Secrets Manager, EBS mount path) to services
    - _Requirements: 9.1, 9.2, 9.4, 9.5, 9.7_

  - [x] 15.4 Write property test for fault isolation
    - **Property 5: Fault isolation — Catalog Service unaffected by EBS fault**
    - For any catalog API request made while a fault is active on the Orders Service EBS volume, verify the Catalog Service returns HTTP 200 with correct data
    - **Validates: Requirements 4.3, 11.1**

  - [x] 15.5 Write property test for fault impact on Orders Service
    - **Property 6: Fault impact — Orders Service fails during active fault**
    - For any valid checkout request submitted while a fault is active on the EBS volume, verify the Orders Service returns HTTP 500 for EBS-dependent operations
    - **Validates: Requirement 4.1**

  - [x] 15.6 Write property test for data integrity across fault lifecycle
    - **Property 9: Data integrity — pre-fault orders survive fault lifecycle**
    - For any set of orders created before fault injection, verify all order records remain intact and queryable in RDS throughout the fault injection and reset lifecycle
    - **Validates: Requirement 11.2**

  - [x] 15.7 Write unit tests for error handling middleware
    - Test EBS write timeout returns HTTP 500 with "EBS_IO_TIMEOUT"
    - Test DB connection error returns HTTP 503 with "DB_CONNECTION_ERROR"
    - Test fault injection script failure logs error and returns HTTP 200 with warning
    - _Requirements: 13.1, 13.2, 13.3_

- [x] 16. Final checkpoint — Ensure all tests pass
  - Run `npm test -- --run` in all service directories. Verify all unit tests and property tests pass. Ensure `terraform validate` succeeds for the complete Terraform configuration. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at infrastructure, backend, and integration stages
- Property tests validate the 10 universal correctness properties from the design document
- Unit tests validate specific examples, edge cases, and error conditions
- TypeScript strict mode is used across all application code per project conventions
- Vitest is the test runner per workspace conventions; fast-check is used for property-based tests
- Terraform files use HCL syntax; application code uses TypeScript with Express.js
