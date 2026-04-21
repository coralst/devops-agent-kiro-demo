# Requirements Document

## Introduction

This feature adds an interactive architecture health dashboard to the DevOps Demo Store frontend. The dashboard renders an SVG-based diagram of the full AWS infrastructure (S3 → ALB → EC2 services → RDS / EBS), with live health status indicators on each component and a real-time EBS disk usage percentage counter. The EBS volume node is visually smaller than other components to reflect its role as an attached storage device. Additionally, the Terraform EBS volume size is reduced from 20 GB to 2 GB so that fault injection fills the disk faster, making the percentage counter more dramatic during demos.

## Glossary

- **Dashboard**: The architecture health dashboard section rendered in the frontend UI, displaying infrastructure components and their live status.
- **Diagram_Renderer**: The frontend module responsible for drawing the SVG-based architecture diagram with nodes, edges, and status indicators.
- **Health_Poller**: The frontend module that periodically fetches health and fault status data from backend API endpoints and dispatches updates to the Dashboard.
- **Status_Indicator**: A visual element (colored circle or badge) rendered near each component node in the diagram, reflecting the component's current health state.
- **EBS_Usage_Counter**: A numeric percentage label rendered near the EBS volume node that displays the current disk usage and updates in real time.
- **Catalog_Service**: The backend Node.js service running on EC2 that serves product data and exposes a health endpoint at GET /api/catalog/health.
- **Orders_Service**: The backend Node.js service running on EC2 that handles checkout, fault injection, and exposes a health endpoint at GET /api/orders/health and fault status at GET /api/orders/fault-status.
- **Health_Status**: One of three values — "healthy" (green), "degraded" (yellow), or "unhealthy" (red) — as defined by the HealthCheckStatus type.
- **Fault_Status**: The current state of the fault injection mechanism, including diskUsagePercent, as defined by the FaultStatus interface.
- **Component_Node**: An SVG group element representing a single infrastructure component (S3, ALB, EC2, RDS, or EBS) in the architecture diagram.

## Requirements

### Requirement 1: Architecture Diagram Rendering

**User Story:** As a demo operator, I want to see a visual architecture diagram of the infrastructure on the website, so that I can understand the system topology at a glance.

#### Acceptance Criteria

1. WHEN the Dashboard page loads, THE Diagram_Renderer SHALL render an SVG-based architecture diagram containing Component_Nodes for: S3 Frontend, ALB, Catalog Service EC2, Orders Service EC2, RDS PostgreSQL, and EBS Volume.
2. THE Diagram_Renderer SHALL draw directed edges between Component_Nodes to represent data flow: S3 → ALB, ALB → Catalog Service EC2, ALB → Orders Service EC2, Catalog Service EC2 → RDS, Orders Service EC2 → RDS, and Orders Service EC2 → EBS Volume.
3. THE Diagram_Renderer SHALL render each Component_Node with a label identifying the infrastructure component name and an icon or shape distinguishing its type (storage, compute, database, load balancer).
4. THE Diagram_Renderer SHALL render the EBS Volume Component_Node at 60% of the width and height of other Component_Nodes to visually indicate its role as attached storage.
5. THE Diagram_Renderer SHALL use inline SVG elements created via DOM manipulation, without requiring React, Vue, or Angular frameworks.

### Requirement 2: Health Status Indicators

**User Story:** As a demo operator, I want to see color-coded health status indicators near each service component, so that I can immediately identify which parts of the system are healthy, degraded, or unhealthy.

#### Acceptance Criteria

1. THE Diagram_Renderer SHALL render a Status_Indicator adjacent to each service Component_Node (Catalog Service EC2, Orders Service EC2, RDS PostgreSQL, and EBS Volume).
2. WHEN the Health_Poller receives a Health_Status of "healthy" for a component, THE Status_Indicator for that component SHALL display as a green circle.
3. WHEN the Health_Poller receives a Health_Status of "degraded" for a component, THE Status_Indicator for that component SHALL display as a yellow circle.
4. WHEN the Health_Poller receives a Health_Status of "unhealthy" for a component, THE Status_Indicator for that component SHALL display as a red circle.
5. WHILE the Health_Poller has not yet received an initial response, THE Status_Indicator for each component SHALL display as a gray circle indicating an unknown state.
6. THE Status_Indicator SHALL include a CSS transition of 300 milliseconds when changing between Health_Status colors to provide a smooth visual update.

### Requirement 3: Live EBS Disk Usage Counter

**User Story:** As a demo operator, I want to see a live percentage counter showing how full the EBS volume is, so that I can observe fault injection filling the disk in real time.

#### Acceptance Criteria

1. THE Diagram_Renderer SHALL render the EBS_Usage_Counter as a text label adjacent to the EBS Volume Component_Node displaying the current diskUsagePercent value followed by a "%" symbol.
2. WHEN the Health_Poller receives updated Fault_Status data, THE EBS_Usage_Counter SHALL update its displayed percentage value within 1 render frame.
3. WHILE fault injection is active, THE EBS_Usage_Counter text SHALL change color to red when diskUsagePercent exceeds 80%.
4. WHILE fault injection is not active and diskUsagePercent is at or below 80%, THE EBS_Usage_Counter text SHALL display in the default text color.
5. THE EBS_Usage_Counter SHALL display "—%" WHILE the Health_Poller has not yet received an initial Fault_Status response.

### Requirement 4: Health and Fault Status Polling

**User Story:** As a demo operator, I want the dashboard to automatically refresh health and disk usage data, so that I see live changes without manually reloading the page.

#### Acceptance Criteria

1. WHEN the Dashboard initializes, THE Health_Poller SHALL begin polling GET /api/catalog/health and GET /api/orders/health at an interval of 5 seconds.
2. WHEN the Dashboard initializes, THE Health_Poller SHALL begin polling GET /api/orders/fault-status at an interval of 2 seconds to capture rapid disk usage changes during fault injection.
3. WHEN the Health_Poller receives a successful response from GET /api/catalog/health, THE Health_Poller SHALL extract the Health_Status and database detail and dispatch them to the Dashboard.
4. WHEN the Health_Poller receives a successful response from GET /api/orders/health, THE Health_Poller SHALL extract the Health_Status, database detail, and ebsVolume detail and dispatch them to the Dashboard.
5. WHEN the Health_Poller receives a successful response from GET /api/orders/fault-status, THE Health_Poller SHALL extract the diskUsagePercent and active flag and dispatch them to the Dashboard.
6. IF the Health_Poller receives a network error or non-200 response from any health endpoint, THEN THE Health_Poller SHALL set the corresponding component Health_Status to "unhealthy" and continue polling at the configured interval.
7. WHEN the Dashboard is removed from the DOM or the page is navigated away, THE Health_Poller SHALL stop all active polling intervals to prevent memory leaks.

### Requirement 5: Fault Status API Endpoint

**User Story:** As a frontend developer, I want a dedicated API endpoint that returns the current fault injection status including disk usage percentage, so that the dashboard can poll for live EBS data without triggering health check side effects.

#### Acceptance Criteria

1. THE Orders_Service SHALL expose a GET /api/orders/fault-status endpoint that returns the current Fault_Status object as JSON.
2. WHEN GET /api/orders/fault-status is called, THE Orders_Service SHALL invoke the getFaultStatus function with the configured EBS mount path and return the result with HTTP status 200.
3. IF the getFaultStatus function throws an error, THEN THE Orders_Service SHALL return HTTP status 500 with a JSON body containing an error message and an error code of "FAULT_STATUS_ERROR".
4. THE ALB SHALL route requests matching the path pattern /api/orders/* to the Orders Service target group, which already covers the new /api/orders/fault-status endpoint without additional ALB configuration.

### Requirement 6: Reduce EBS Volume Size

**User Story:** As a demo operator, I want the EBS volume to be much smaller (2 GB instead of 20 GB), so that fault injection fills the disk faster and the percentage counter shows dramatic changes during demos.

#### Acceptance Criteria

1. THE Terraform EBS volume resource for the Orders Service SHALL specify a size of 2 GB instead of the current 20 GB.
2. WHEN the infrastructure is redeployed after the size change, THE EBS volume SHALL be provisioned as a 2 GB gp3 volume with encryption enabled.
3. THE Terraform EBS volume resource SHALL retain all other existing configuration (gp3 type, encryption, availability zone, tags) unchanged.

### Requirement 7: Diagram Visual Design

**User Story:** As a demo operator, I want the architecture diagram to look professional and visually appealing, so that it is suitable for live demos and presentations.

#### Acceptance Criteria

1. THE Diagram_Renderer SHALL use a color palette consistent with the existing DevOps Demo Store theme (dark header #1a1a2e, accent #e94560, background #f5f5f5).
2. THE Diagram_Renderer SHALL render edges between Component_Nodes as smooth paths with arrowheads indicating data flow direction.
3. THE Diagram_Renderer SHALL arrange Component_Nodes in a left-to-right flow layout: S3 on the far left, ALB in the center-left, EC2 services in the center, RDS and EBS on the right.
4. THE Diagram_Renderer SHALL render each Component_Node with rounded corners and a subtle drop shadow to create visual depth.
5. THE Diagram_Renderer SHALL be responsive, scaling the SVG viewBox to fit the available container width while maintaining the aspect ratio of the diagram.
6. THE Diagram_Renderer SHALL render the EBS Volume Component_Node positioned below and to the right of the Orders Service EC2 node to visually indicate it is an attached volume rather than a peer service.

### Requirement 8: Dashboard Integration with Existing UI

**User Story:** As a demo operator, I want the architecture dashboard to be integrated into the existing DevOps Demo Store page, so that I can see both the product grid and the system health in one view.

#### Acceptance Criteria

1. THE Dashboard SHALL be rendered as a new section in the existing index.html page, positioned between the header and the product grid.
2. THE Dashboard section SHALL include a heading labeled "Architecture Health" to identify the diagram area.
3. THE Dashboard SHALL not interfere with the existing product grid, notification banner, or reset button functionality.
4. WHEN the page loads, THE Dashboard SHALL initialize and begin polling independently of the product grid loading sequence.
5. THE Dashboard section SHALL be collapsible, allowing the user to hide the diagram and show only the product grid by clicking a toggle control.
