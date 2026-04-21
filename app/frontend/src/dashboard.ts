import { createDiagramRenderer } from './diagram-renderer';
import type { DiagramRenderer, NodeHealthState } from './diagram-renderer';
import { createHealthPoller } from './health-poller';
import type { HealthPoller } from './health-poller';

export interface Dashboard {
  /** Initialize the dashboard: create DOM, start polling. */
  init(): void;
  /** Tear down: stop polling, remove event listeners, remove DOM. */
  destroy(): void;
}

/** Create a dashboard orchestrator that wires the diagram renderer and health poller together. */
export function createDashboard(): Dashboard {
  let initialized = false;
  let sectionEl: HTMLElement | null = null;
  let renderer: DiagramRenderer | null = null;
  let poller: HealthPoller | null = null;
  let beforeUnloadHandler: (() => void) | null = null;

  // Track which backends have responded and which have errored,
  // so we can derive ALB status.
  let catalogResponded = false;
  let ordersResponded = false;
  let catalogFailed = false;
  let ordersFailed = false;

  function deriveAlbStatus(): NodeHealthState {
    // If neither has responded yet, stay unknown
    if (!catalogResponded && !ordersResponded) return 'unknown';
    // Healthy if at least one backend responds successfully
    if (!catalogFailed || !ordersFailed) return 'healthy';
    // Both failed
    return 'unhealthy';
  }

  function updateAlb(): void {
    if (renderer) {
      renderer.updateNodeStatus('alb', deriveAlbStatus());
    }
  }

  return {
    init() {
      if (initialized) return;
      initialized = true;

      // --- Build DOM structure ---
      sectionEl = document.createElement('section');
      sectionEl.className = 'arch-dashboard';

      // Header with title and collapse toggle
      const headerDiv = document.createElement('div');
      headerDiv.className = 'arch-dashboard__header';

      const heading = document.createElement('h2');
      heading.textContent = 'Architecture Health';
      headerDiv.appendChild(heading);

      const toggleBtn = document.createElement('button');
      toggleBtn.className = 'arch-dashboard__toggle';
      toggleBtn.textContent = '▼';
      toggleBtn.type = 'button';
      headerDiv.appendChild(toggleBtn);

      sectionEl.appendChild(headerDiv);

      // Content container for the SVG
      const contentDiv = document.createElement('div');
      contentDiv.className = 'arch-dashboard__content';
      sectionEl.appendChild(contentDiv);

      // Collapse toggle behavior
      toggleBtn.addEventListener('click', () => {
        const isCollapsed = contentDiv.classList.toggle('collapsed');
        toggleBtn.textContent = isCollapsed ? '▲' : '▼';
      });

      // --- Insert into DOM ---
      // Place the dashboard at the end of <main>, below the product grid
      const main = document.querySelector('main');
      if (main) {
        main.appendChild(sectionEl);
      } else {
        // Fallback: append to <body>
        document.body.appendChild(sectionEl);
      }

      // --- Diagram Renderer ---
      renderer = createDiagramRenderer();
      renderer.render(contentDiv);

      // S3 is always healthy (if the page loaded, S3 works)
      renderer.updateNodeStatus('s3', 'healthy');

      // --- Health Poller ---
      poller = createHealthPoller({
        healthIntervalMs: 5000,
        faultStatusIntervalMs: 2000,

        onCatalogHealth(health) {
          catalogResponded = true;
          catalogFailed = false;

          if (renderer) {
            // Map HealthCheckStatus to NodeHealthState (they share the same string values)
            renderer.updateNodeStatus('catalog-ec2', health.status as NodeHealthState);

            // Derive RDS status from details.database
            const rdsStatus: NodeHealthState = health.details.database ? 'healthy' : 'unhealthy';
            renderer.updateNodeStatus('rds', rdsStatus);
          }

          updateAlb();
        },

        onOrdersHealth(health) {
          ordersResponded = true;
          ordersFailed = false;

          if (renderer) {
            renderer.updateNodeStatus('orders-ec2', health.status as NodeHealthState);

            // Derive RDS status from details.database
            const rdsStatus: NodeHealthState = health.details.database ? 'healthy' : 'unhealthy';
            renderer.updateNodeStatus('rds', rdsStatus);

            // Derive EBS status from details.ebsVolume
            let ebsStatus: NodeHealthState;
            if (health.details.ebsVolume === true) {
              ebsStatus = 'healthy';
            } else if (health.details.ebsVolume === false) {
              ebsStatus = 'degraded';
            } else {
              ebsStatus = 'unknown';
            }
            renderer.updateNodeStatus('ebs', ebsStatus);
          }

          updateAlb();
        },

        onFaultStatus(status) {
          if (renderer) {
            renderer.updateEbsUsage(status.diskUsagePercent);
          }
        },

        onError(service) {
          if (renderer) {
            // Map service name to component ID
            if (service === 'catalog') {
              catalogResponded = true;
              catalogFailed = true;
              renderer.updateNodeStatus('catalog-ec2', 'unhealthy');
            } else if (service === 'orders') {
              ordersResponded = true;
              ordersFailed = true;
              renderer.updateNodeStatus('orders-ec2', 'unhealthy');
            } else if (service === 'fault-status') {
              renderer.updateNodeStatus('ebs', 'unhealthy');
            }
          }

          updateAlb();
        },
      });

      poller.start();

      // --- beforeunload cleanup ---
      beforeUnloadHandler = () => {
        if (poller) poller.stop();
      };
      window.addEventListener('beforeunload', beforeUnloadHandler);
    },

    destroy() {
      if (poller) {
        poller.stop();
        poller = null;
      }

      if (beforeUnloadHandler) {
        window.removeEventListener('beforeunload', beforeUnloadHandler);
        beforeUnloadHandler = null;
      }

      if (sectionEl && sectionEl.parentNode) {
        sectionEl.parentNode.removeChild(sectionEl);
        sectionEl = null;
      }

      renderer = null;
      initialized = false;
    },
  };
}
