# Implementation Plan: Architecture Health Dashboard

## Overview

This plan implements a live SVG-based architecture health dashboard for the DevOps Demo Store. The work is organized into backend endpoint creation, frontend module development (API extensions, diagram renderer, health poller, dashboard orchestrator), infrastructure changes, and CSS styling. Each task builds incrementally so there is no orphaned code at any step.

## Tasks

- [x] 1. Add fault-status backend endpoint and API extensions
  - [x] 1.1 Add `GET /api/orders/fault-status` route to Orders Service
    - Add a new route in `app/orders-service/src/routes.ts` that calls `getFaultStatus()` and returns the `FaultStatus` JSON
    - Register the route **before** the `GET /api/orders/:id` catch-all to avoid Express treating "fault-status" as an order ID
    - On success return HTTP 200 with the `FaultStatus` object; on error return HTTP 500 with `{ error: "<message>", code: "FAULT_STATUS_ERROR" }`
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ]* 1.2 Write integration tests for the fault-status endpoint
    - Add tests in `app/orders-service/src/routes.test.ts` for `GET /api/orders/fault-status`
    - Test 200 response with correct `FaultStatus` shape when `getFaultStatus` succeeds
    - Test 500 response with `FAULT_STATUS_ERROR` code when `getFaultStatus` throws
    - Test that the route is matched before the `:id` catch-all (request to `/api/orders/fault-status` does not hit the `:id` handler)
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 1.3 Add three new fetch wrappers to `app/frontend/src/api.ts`
    - Add `getCatalogHealth()` → `GET /api/catalog/health` returning `HealthCheck`
    - Add `getOrdersHealth()` → `GET /api/orders/health` returning `HealthCheck`
    - Add `getOrdersFaultStatus()` → `GET /api/orders/fault-status` returning `FaultStatus`
    - Import `HealthCheck` and `FaultStatus` types from `../../shared/types`
    - Each wrapper throws on non-200 responses
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [ ]* 1.4 Write unit tests for the new API fetch wrappers
    - Add tests in `app/frontend/src/api.test.ts` for `getCatalogHealth`, `getOrdersHealth`, `getOrdersFaultStatus`
    - Test success responses return parsed JSON
    - Test non-200 responses throw errors
    - _Requirements: 4.1, 4.2_

- [x] 2. Checkpoint — Verify backend endpoint and API wrappers
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implement the diagram renderer module
  - [x] 3.1 Create `app/frontend/src/diagram-renderer.ts`
    - Export types: `NodeHealthState`, `ComponentId`, `DiagramRenderer` interface
    - Export `createDiagramRenderer()` factory function
    - Implement `render(container)`: create an inline `<svg>` with `viewBox="0 0 900 400"` and `preserveAspectRatio="xMidYMid meet"`
    - Add `<defs>` with arrowhead marker and drop shadow filter
    - Render 6 `ComponentNode` groups at specified positions: S3 (80,200), ALB (260,200), Catalog EC2 (460,120), Orders EC2 (460,280), RDS (680,120), EBS (680,330)
    - Each node: rounded `<rect>` (rx/ry for corners), icon `<text>` (emoji/Unicode), label `<text>`, drop shadow via filter
    - EBS node at 60% size (72×48) vs standard nodes (120×80)
    - Render 6 directed edges as smooth `<path>` elements with arrowhead markers: S3→ALB, ALB→Catalog EC2, ALB→Orders EC2, Catalog EC2→RDS, Orders EC2→RDS, Orders EC2→EBS
    - Add status indicator `<circle>` elements (class `status-indicator`) for Catalog EC2, Orders EC2, RDS, and EBS nodes, initially gray (`#6c757d`)
    - Add EBS usage counter `<text>` element (class `ebs-usage`) near EBS node, initially showing "—%"
    - Use theme colors: dark header `#1a1a2e`, accent `#e94560`, background `#f5f5f5`
    - Implement `updateNodeStatus(componentId, status)`: set the status indicator fill to green/yellow/red/gray based on state; silently ignore invalid componentIds
    - Implement `updateEbsUsage(percent)`: set EBS counter text to `"{percent}%"` or `"—%"` for null/NaN; add `ebs-usage--critical` class when percent > 80, remove it otherwise
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ]* 3.2 Write property test: Node rendering includes label and icon (Property 1)
    - Create `app/frontend/src/diagram-renderer.property.test.ts`
    - Install `fast-check@^3.22.0` as a dev dependency in `app/frontend`
    - **Property 1: Node rendering includes label and icon**
    - Generate random `NodeConfig` objects with non-empty `label` and `icon` strings
    - Assert the rendered SVG group contains text elements matching the label and icon
    - **Validates: Requirements 1.3**

  - [ ]* 3.3 Write property test: Status indicator color mapping (Property 2)
    - **Property 2: Status indicator color mapping**
    - Generate random `(ComponentId, NodeHealthState)` pairs from the valid sets
    - Assert `updateNodeStatus` sets the indicator fill to the correct color: `#28a745` (healthy), `#ffc107` (degraded), `#dc3545` (unhealthy), `#6c757d` (unknown)
    - **Validates: Requirements 2.2, 2.3, 2.4, 2.5**

  - [ ]* 3.4 Write property test: EBS usage counter displays correct percentage text (Property 3)
    - **Property 3: EBS usage counter displays correct percentage text**
    - Generate random integers 0–100 and null
    - Assert `updateEbsUsage(percent)` sets text to `"{percent}%"` or `"—%"` for null
    - **Validates: Requirements 3.1, 3.5**

  - [ ]* 3.5 Write property test: EBS usage counter color follows 80% threshold (Property 4)
    - **Property 4: EBS usage counter color follows 80% threshold**
    - Generate random integers 0–100
    - Assert the `ebs-usage--critical` class is present if and only if percent > 80
    - **Validates: Requirements 3.3, 3.4**

  - [ ]* 3.6 Write unit tests for diagram renderer
    - Create `app/frontend/src/diagram-renderer.test.ts`
    - Test SVG structure: 6 node groups, 6 edge paths, viewBox attribute, preserveAspectRatio
    - Test EBS node dimensions are 60% of standard (72×48 vs 120×80)
    - Test arrowhead marker and drop shadow filter exist in `<defs>`
    - Test all nodes have rounded corners (rx/ry attributes on rects)
    - Test initial status indicators are gray (`#6c757d`)
    - Test initial EBS counter shows "—%"
    - Test CSS transition attribute on status indicators (300ms)
    - Test node positions match the layout spec
    - Test theme colors are applied
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.5, 2.6, 3.5, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [x] 4. Checkpoint — Verify diagram renderer
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement the health poller module
  - [x] 5.1 Create `app/frontend/src/health-poller.ts`
    - Export `HealthPollerConfig` interface with: `healthIntervalMs` (default 5000), `faultStatusIntervalMs` (default 2000), callback functions (`onCatalogHealth`, `onOrdersHealth`, `onFaultStatus`, `onError`)
    - Export `HealthPoller` interface with `start()` and `stop()` methods
    - Export `createHealthPoller(config)` factory function
    - `start()` initiates two `setInterval` loops: one calling `getCatalogHealth()` and `getOrdersHealth()` every 5s, one calling `getOrdersFaultStatus()` every 2s
    - Each loop invokes the success callback on success or `onError` callback on failure (network error, non-200, JSON parse error)
    - On error, polling continues at the configured interval (never stops)
    - `stop()` calls `clearInterval` on both timers
    - Perform an immediate first poll on `start()` before waiting for the first interval
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [ ]* 5.2 Write property test: Health poller dispatches correct health data (Property 5)
    - Create `app/frontend/src/health-poller.property.test.ts`
    - **Property 5: Health poller dispatches correct health data**
    - Generate random `HealthCheck` objects with varying `status`, `database`, and `ebsVolume` values
    - Mock fetch to return the generated object; assert the corresponding callback receives a deeply equal copy
    - **Validates: Requirements 4.3, 4.4**

  - [ ]* 5.3 Write property test: Fault status poller dispatches correct fault data (Property 6)
    - **Property 6: Fault status poller dispatches correct fault data**
    - Generate random `FaultStatus` objects with `diskUsagePercent` in [0,100], any `active` boolean, any `volumePath` string
    - Mock fetch to return the generated object; assert `onFaultStatus` callback receives a deeply equal copy
    - **Validates: Requirements 4.5**

  - [ ]* 5.4 Write property test: Health poller error handling preserves polling (Property 7)
    - **Property 7: Health poller error handling preserves polling**
    - Generate random HTTP error status codes (400–599) and network errors
    - Assert `onError` callback is invoked with the failing service name and polling intervals remain active (not cleared)
    - **Validates: Requirements 4.6**

  - [ ]* 5.5 Write unit tests for health poller
    - Create `app/frontend/src/health-poller.test.ts`
    - Test interval configuration: health polls at 5s, fault-status at 2s
    - Test `stop()` clears both intervals
    - Test immediate first poll on `start()`
    - Test error callback invoked on fetch failure, polling continues
    - _Requirements: 4.1, 4.2, 4.6, 4.7_

- [x] 6. Checkpoint — Verify health poller
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Implement the dashboard orchestrator and wire everything together
  - [x] 7.1 Create `app/frontend/src/dashboard.ts`
    - Export `Dashboard` interface with `init()` and `destroy()` methods
    - Export `createDashboard()` factory function
    - `init()` creates a `<section>` element with class `arch-dashboard`, heading "Architecture Health", a collapse toggle button, and a container `<div>` for the SVG
    - Insert the section into the DOM between the `<header>` and `<main>` elements; fall back to prepending to `<body>` if header not found
    - Create a `DiagramRenderer` via `createDiagramRenderer()` and call `render()` into the container
    - Create a `HealthPoller` with callbacks that map API responses to renderer updates:
      - Catalog health → update `catalog-ec2` status; derive `rds` status from `details.database`
      - Orders health → update `orders-ec2` status; derive `rds` and `ebs` status from `details.database` and `details.ebsVolume`
      - Fault status → call `updateEbsUsage(diskUsagePercent)`
      - On error → set the failing component to `unhealthy`
    - S3 node always shown as `healthy`; ALB derived as `healthy` if at least one backend responds, `unhealthy` if both fail
    - Collapse toggle hides/shows the SVG container via `collapsed` CSS class
    - Register `beforeunload` listener to call `HealthPoller.stop()`
    - `init()` is idempotent — second call is a no-op if already initialized
    - `destroy()` stops the poller and removes event listeners
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 4.7_

  - [x] 7.2 Wire dashboard into `app/frontend/src/main.ts`
    - Import `createDashboard` from `./dashboard`
    - Call `createDashboard().init()` after DOM is ready (alongside existing `init()` call)
    - Dashboard initialization must be independent of product grid loading
    - _Requirements: 8.3, 8.4_

  - [ ]* 7.3 Write property test: Collapse toggle alternates visibility (Property 8)
    - Create `app/frontend/src/dashboard.property.test.ts`
    - **Property 8: Collapse toggle alternates visibility**
    - Generate random non-negative integers `n` for click count
    - Assert dashboard content is visible when `n` is even, hidden when `n` is odd (starting visible at n=0)
    - **Validates: Requirements 8.5**

  - [ ]* 7.4 Write unit tests for dashboard orchestrator
    - Create `app/frontend/src/dashboard.test.ts`
    - Test DOM insertion position: section is between header and main
    - Test heading text is "Architecture Health"
    - Test collapse toggle button exists and toggles visibility
    - Test `init()` is idempotent (calling twice doesn't duplicate the section)
    - Test dashboard does not interfere with existing product grid, notification, or reset button elements
    - _Requirements: 8.1, 8.2, 8.3, 8.5_

- [x] 8. Checkpoint — Verify dashboard integration
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Add CSS styles and Terraform infrastructure change
  - [x] 9.1 Add dashboard CSS styles to `app/frontend/src/styles.css`
    - Add `.arch-dashboard` section styles (background, padding, margin, border-radius)
    - Add `.arch-dashboard__header` styles (flex layout for heading + toggle)
    - Add `.arch-dashboard__toggle` button styles (consistent with existing theme)
    - Add `.arch-dashboard__content` styles and `.arch-dashboard__content.collapsed { display: none; }`
    - Add `.arch-dashboard svg { width: 100%; height: auto; }` for responsive scaling
    - Add `.status-indicator { transition: fill 300ms ease; }` for smooth color transitions
    - Add `.ebs-usage { font-weight: 700; }` and `.ebs-usage--critical { fill: #dc3545; }` for EBS counter
    - _Requirements: 2.6, 7.1, 7.5, 8.5_

  - [x] 9.2 Change EBS volume size in `terraform/ec2-orders.tf`
    - Change `size = 20` to `size = 2` in the `aws_ebs_volume.orders_data` resource
    - Retain all other configuration (gp3 type, encryption, availability zone, tags) unchanged
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 10. Final checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each major module
- Property tests validate universal correctness properties from the design document using fast-check
- Unit tests validate specific examples, edge cases, and structural correctness
- The design uses TypeScript throughout — all implementation uses TypeScript
- No changes to `index.html` are needed; the dashboard section is created dynamically via JS
