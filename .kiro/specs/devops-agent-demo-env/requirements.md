# Requirements Document

## Introduction

This document defines the requirements for the DevOps Agent Demo Environment — an AWS-based e-commerce platform built on a microservices architecture. The environment is purpose-built to demonstrate localized failure isolation: a user-triggered EBS volume degradation on the Orders Service causes observable failures (HTTP 500s, latency spikes) while the Catalog Service continues operating normally. CloudWatch alarms detect the degradation and publish to an SNS topic for downstream consumption by a DevOps agent (not part of this deliverable). All infrastructure is defined in Terraform; application code is TypeScript.

## Glossary

- **Demo_Environment**: The complete AWS infrastructure and application stack deployed by this project
- **Frontend**: The S3-hosted static website serving the e-commerce UI
- **Catalog_Service**: The Express.js backend running on EC2 that serves product catalog data
- **Orders_Service**: The Express.js backend running on EC2 that handles checkout operations and hosts the fault injection mechanism
- **ALB**: The Application Load Balancer that routes requests between Frontend and backend services
- **EBS_Volume**: The dedicated gp3 EBS volume attached to the Orders Service EC2 instance, used as the fault injection target
- **Fault_Injection_Script**: The shell-level mechanism (fio/dd) that degrades the EBS volume to simulate storage failure
- **Trigger_Item**: The specific product in the catalog (id: "TRIGGER_ITEM") whose purchase activates fault injection
- **CloudWatch_Alarm_Stack**: The set of three CloudWatch alarms monitoring EBS queue length, ALB 5XX count, and API latency
- **SNS_Topic**: The SNS topic that receives alarm state change notifications
- **RDS_Database**: The PostgreSQL RDS instance storing product and order data
- **Health_Check**: The endpoint on each backend service that reports service health to the ALB

## Requirements

### Requirement 1: Catalog Browsing

**User Story:** As a demo user, I want to browse the product catalog, so that I can see available items including the fault-trigger item.

#### Acceptance Criteria

1. WHEN a user requests the product catalog, THE Catalog_Service SHALL return a list of all products from the RDS_Database with HTTP 200
2. WHEN a user requests a specific product by ID, THE Catalog_Service SHALL return the product details with HTTP 200
3. IF a requested product ID does not exist, THEN THE Catalog_Service SHALL return an HTTP 404 response with a descriptive error message
4. THE Catalog_Service SHALL expose a health check endpoint at `/api/catalog/health` that returns service status

### Requirement 2: Order Checkout

**User Story:** As a demo user, I want to place orders through the checkout flow, so that the system processes purchases and writes order records.

#### Acceptance Criteria

1. WHEN a user submits a valid checkout request with a non-empty item ID and positive quantity, THE Orders_Service SHALL create an order record in the RDS_Database and return a confirmation with HTTP 200
2. WHEN a user submits a checkout request with an empty item ID or non-positive quantity, THE Orders_Service SHALL reject the request with an HTTP 400 validation error
3. IF the requested product ID does not exist in the RDS_Database, THEN THE Orders_Service SHALL return an HTTP 404 error
4. WHEN an order is created, THE Orders_Service SHALL write an order log entry to the EBS_Volume
5. WHEN a non-trigger order is confirmed, THE Orders_Service SHALL update the order status to "confirmed" in the RDS_Database

### Requirement 3: Fault Injection Trigger

**User Story:** As a demo operator, I want purchasing the Trigger_Item to activate EBS volume degradation, so that I can demonstrate localized failure to an audience.

#### Acceptance Criteria

1. WHEN a checkout request contains the Trigger_Item ID, THE Orders_Service SHALL execute the Fault_Injection_Script against the EBS_Volume
2. WHEN the Trigger_Item is purchased, THE Orders_Service SHALL return a checkout response with `faultInjected: true`
3. WHILE a fault is already active on the EBS_Volume, THE Fault_Injection_Script SHALL skip execution and not stack additional fault processes (idempotent behavior)
4. WHEN the Fault_Injection_Script executes, THE Fault_Injection_Script SHALL launch an fio process with random writes to exhaust EBS IOPS
5. WHEN the Fault_Injection_Script executes, THE Fault_Injection_Script SHALL launch a dd process to fill disk space on the EBS_Volume
6. WHEN the Fault_Injection_Script completes initialization, THE Fault_Injection_Script SHALL create a `.fault-active` marker file on the EBS_Volume with a timestamp

### Requirement 4: Fault Impact on Orders Service

**User Story:** As a demo operator, I want the EBS degradation to cause observable failures on the Orders Service, so that the DevOps agent has clear symptoms to investigate.

#### Acceptance Criteria

1. WHILE a fault is active on the EBS_Volume, THE Orders_Service SHALL return HTTP 500 errors for checkout requests that require EBS writes
2. WHILE a fault is active on the EBS_Volume, THE Orders_Service health check SHALL report status as "degraded"
3. WHILE a fault is active on the EBS_Volume, THE Catalog_Service SHALL continue responding to all requests with HTTP 200 (fault isolation)

### Requirement 5: Fault Reset

**User Story:** As a demo operator, I want to reset the fault injection, so that I can restore the environment for the next demo run.

#### Acceptance Criteria

1. WHEN a reset request is received, THE Orders_Service SHALL terminate all fio processes on the EBS_Volume
2. WHEN a reset request is received, THE Orders_Service SHALL terminate all dd processes on the EBS_Volume
3. WHEN a reset request is received, THE Orders_Service SHALL remove all stress-generated files from the EBS_Volume
4. WHEN a reset request is received, THE Orders_Service SHALL remove the `.fault-active` marker file
5. WHEN the reset completes, THE Orders_Service SHALL return a response containing the current disk usage percentage
6. WHEN the reset completes, THE Orders_Service SHALL report `getFaultStatus().active === false`

### Requirement 6: Health Check Accuracy

**User Story:** As the ALB, I want accurate health check responses from each backend service, so that I can route traffic appropriately.

#### Acceptance Criteria

1. WHEN both the RDS_Database and EBS_Volume are responsive, THE Orders_Service health check SHALL return status "healthy"
2. WHEN the RDS_Database is responsive but EBS_Volume I/O latency exceeds 5 seconds, THE Orders_Service health check SHALL return status "degraded"
3. WHEN the RDS_Database is unreachable, THE Orders_Service health check SHALL return status "unhealthy"
4. THE Catalog_Service health check SHALL verify RDS_Database connectivity and return "healthy" or "unhealthy" accordingly
5. WHEN the health check writes and reads a test file on the EBS_Volume, THE Orders_Service SHALL clean up the test file after the check completes

### Requirement 7: CloudWatch Observability

**User Story:** As a DevOps agent (downstream consumer), I want CloudWatch alarms to detect EBS degradation, 5XX spikes, and latency increases, so that I receive timely notifications of the failure.

#### Acceptance Criteria

1. THE CloudWatch_Alarm_Stack SHALL include an alarm that triggers when EBS VolumeQueueLength exceeds its configured threshold
2. THE CloudWatch_Alarm_Stack SHALL include an alarm that triggers when ALB 5XX error count exceeds its configured threshold
3. THE CloudWatch_Alarm_Stack SHALL include an alarm that triggers when ALB TargetResponseTime exceeds its configured threshold
4. WHEN any CloudWatch alarm transitions to ALARM state, THE CloudWatch_Alarm_Stack SHALL publish the state change to the SNS_Topic
5. WHEN any CloudWatch alarm transitions back to OK state, THE CloudWatch_Alarm_Stack SHALL publish the state change to the SNS_Topic
6. THE Demo_Environment SHALL enable 1-minute detailed monitoring for EC2 and EBS metrics

### Requirement 8: ALB Routing

**User Story:** As a user, I want my API requests routed to the correct backend service, so that catalog and order operations are handled by their respective services.

#### Acceptance Criteria

1. WHEN a request path matches `/api/catalog/*`, THE ALB SHALL route the request to the Catalog_Service target group
2. WHEN a request path matches `/api/orders/*`, THE ALB SHALL route the request to the Orders_Service target group
3. WHEN the Orders_Service health check reports "unhealthy", THE ALB SHALL stop routing new requests to the Orders_Service target
4. WHEN the Orders_Service health check recovers to "healthy", THE ALB SHALL resume routing requests to the Orders_Service target

### Requirement 9: Infrastructure as Code

**User Story:** As a developer, I want all infrastructure defined in Terraform, so that the environment is reproducible and version-controlled.

#### Acceptance Criteria

1. THE Demo_Environment SHALL define all AWS resources in Terraform HCL configuration files
2. THE Demo_Environment SHALL place EC2 instances in private subnets accessible only via the ALB
3. THE Demo_Environment SHALL configure security groups with least-privilege rules: ALB accepts inbound 80/443, EC2 accepts only ALB traffic on application ports, RDS accepts only EC2 traffic on port 5432
4. THE Demo_Environment SHALL use IAM instance profiles with minimal permissions for EC2 instances (CloudWatch metrics publishing, SSM access)
5. THE Demo_Environment SHALL store RDS credentials in AWS Secrets Manager
6. THE Demo_Environment SHALL configure the RDS instance as not publicly accessible and encrypted at rest
7. THE Demo_Environment SHALL attach a dedicated gp3 EBS volume to the Orders Service EC2 instance separate from the root volume

### Requirement 10: Frontend UI

**User Story:** As a demo user, I want a simple e-commerce UI, so that I can browse products and trigger the fault scenario visually.

#### Acceptance Criteria

1. THE Frontend SHALL display a product grid populated from the Catalog_Service API
2. WHEN a user clicks "Buy" on a product, THE Frontend SHALL send a checkout request to the Orders_Service API via the ALB
3. WHEN a checkout request succeeds, THE Frontend SHALL display the order confirmation with status
4. WHEN a checkout request fails with HTTP 500, THE Frontend SHALL display an error state to the user
5. THE Frontend SHALL provide a "Reset Fault" button that sends a reset request to the Orders_Service

### Requirement 11: Data Integrity

**User Story:** As a demo operator, I want order records created before fault injection to remain intact, so that the fault only affects EBS-dependent operations.

#### Acceptance Criteria

1. WHILE a fault is active on the EBS_Volume, THE RDS_Database SHALL remain accessible for read and write operations from both services
2. WHEN orders are created before fault injection, THE Orders_Service SHALL preserve those order records in the RDS_Database throughout the fault lifecycle
3. THE Orders_Service SHALL use parameterized queries for all database operations to prevent SQL injection

### Requirement 12: Database Schema and Seed Data

**User Story:** As a developer, I want the database schema and seed data provisioned at deploy time, so that the demo environment is ready to use immediately after deployment.

#### Acceptance Criteria

1. THE RDS_Database SHALL contain a `products` table with columns for id, name, description, price, image_url, category, and is_trigger
2. THE RDS_Database SHALL contain an `orders` table with columns for id, product_id, quantity, total_price, status, and created_at
3. THE RDS_Database SHALL enforce that product price is a positive integer
4. THE RDS_Database SHALL enforce that order quantity is a positive integer
5. WHEN the environment is deployed, THE RDS_Database SHALL be seeded with the Trigger_Item (id: "TRIGGER_ITEM", is_trigger: true) and at least one normal product

### Requirement 13: Error Handling

**User Story:** As a demo operator, I want graceful error handling across all services, so that failures produce clear diagnostic information rather than crashes.

#### Acceptance Criteria

1. WHEN the Orders_Service encounters an EBS write timeout during checkout, THE Orders_Service SHALL return HTTP 500 with error code "EBS_IO_TIMEOUT"
2. WHEN either service loses database connectivity, THE service SHALL return HTTP 503 with error code "DB_CONNECTION_ERROR"
3. IF the fio binary is not installed or the mount path is invalid during fault injection, THEN THE Orders_Service SHALL log the error and return HTTP 200 for the checkout with `faultInjected: false` and a warning message
4. THE Orders_Service SHALL log all errors with context including the operation being attempted and relevant identifiers
