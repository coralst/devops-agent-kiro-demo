/** Health state for a single component node. */
export type NodeHealthState = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

/** The six component nodes in the architecture diagram. */
export type ComponentId = 's3' | 'alb' | 'catalog-ec2' | 'orders-ec2' | 'rds' | 'ebs';

export interface DiagramRenderer {
  /** Create the SVG element and append it to the container. */
  render(container: HTMLElement): void;
  /** Update the health status indicator for a component. */
  updateNodeStatus(componentId: ComponentId, status: NodeHealthState): void;
  /** Update the EBS disk usage percentage display. */
  updateEbsUsage(percent: number | null): void;
}

/* ------------------------------------------------------------------ */
/*  Internal types                                                     */
/* ------------------------------------------------------------------ */

interface NodeConfig {
  id: ComponentId;
  label: string;
  icon: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hasStatusIndicator: boolean;
}

interface EdgeConfig {
  from: ComponentId;
  to: ComponentId;
  path: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SVG_NS = 'http://www.w3.org/2000/svg';

const STATUS_COLORS: Record<NodeHealthState, string> = {
  healthy: '#28a745',
  degraded: '#ffc107',
  unhealthy: '#dc3545',
  unknown: '#6c757d',
};

const THEME = {
  nodeFill: '#ffffff',
  nodeStroke: '#1a1a2e',
  edgeStroke: '#1a1a2e',
  edgeOpacity: '0.6',
  textFill: '#333',
} as const;

const NODES: NodeConfig[] = [
  { id: 's3',         label: 'S3 Frontend',    icon: '🪣',  x: 80,  y: 200, width: 120, height: 80, hasStatusIndicator: false },
  { id: 'alb',        label: 'ALB',            icon: '⚖️',  x: 260, y: 200, width: 120, height: 80, hasStatusIndicator: false },
  { id: 'catalog-ec2', label: 'Catalog EC2',   icon: '🖥️',  x: 460, y: 120, width: 120, height: 80, hasStatusIndicator: true },
  { id: 'orders-ec2', label: 'Orders EC2',     icon: '🖥️',  x: 460, y: 280, width: 120, height: 80, hasStatusIndicator: true },
  { id: 'rds',        label: 'RDS',            icon: '🗄️',  x: 680, y: 120, width: 120, height: 80, hasStatusIndicator: true },
  { id: 'ebs',        label: 'EBS',            icon: '💾',  x: 680, y: 330, width: 72,  height: 48, hasStatusIndicator: true },
];

/** Smooth cubic-bezier edge paths between nodes. */
const EDGES: EdgeConfig[] = [
  { from: 's3',         to: 'alb',        path: 'M 140,200 C 180,200 220,200 260,200' },
  { from: 'alb',        to: 'catalog-ec2', path: 'M 320,200 C 370,200 410,160 460,140' },
  { from: 'alb',        to: 'orders-ec2', path: 'M 320,200 C 370,200 410,240 460,260' },
  { from: 'catalog-ec2', to: 'rds',       path: 'M 520,140 C 570,140 630,140 680,140' },
  { from: 'orders-ec2', to: 'rds',        path: 'M 520,260 C 570,260 630,180 680,160' },
  { from: 'orders-ec2', to: 'ebs',        path: 'M 520,300 C 570,310 630,330 680,340' },
];

/* ------------------------------------------------------------------ */
/*  SVG element helpers                                                */
/* ------------------------------------------------------------------ */

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K];
function svgEl(tag: string): SVGElement;
function svgEl(tag: string): SVGElement {
  return document.createElementNS(SVG_NS, tag);
}

function setAttrs(el: SVGElement, attrs: Record<string, string>): void {
  for (const [key, value] of Object.entries(attrs)) {
    el.setAttribute(key, value);
  }
}

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

export function createDiagramRenderer(): DiagramRenderer {
  /** Map from ComponentId → status indicator <circle> element. */
  const indicators = new Map<string, SVGCircleElement>();
  /** The EBS usage counter <text> element. */
  let ebsUsageText: SVGTextElement | null = null;

  /* ---- build helpers ---- */

  function createDefs(): SVGDefsElement {
    const defs = svgEl('defs');

    // Arrowhead marker
    const marker = svgEl('marker');
    setAttrs(marker, {
      id: 'arrowhead',
      markerWidth: '10',
      markerHeight: '7',
      refX: '10',
      refY: '3.5',
      orient: 'auto',
      markerUnits: 'strokeWidth',
    });
    const arrowPath = svgEl('path');
    setAttrs(arrowPath, {
      d: 'M 0 0 L 10 3.5 L 0 7 Z',
      fill: THEME.nodeStroke,
    });
    marker.appendChild(arrowPath);
    defs.appendChild(marker);

    // Drop shadow filter
    const filter = svgEl('filter');
    setAttrs(filter, { id: 'drop-shadow', x: '-10%', y: '-10%', width: '130%', height: '130%' });

    const feOffset = svgEl('feOffset');
    setAttrs(feOffset, { in: 'SourceAlpha', dx: '2', dy: '2', result: 'offsetOut' });
    filter.appendChild(feOffset);

    const feGaussian = svgEl('feGaussianBlur');
    setAttrs(feGaussian, { in: 'offsetOut', stdDeviation: '3', result: 'blurOut' });
    filter.appendChild(feGaussian);

    const feBlend = svgEl('feBlend');
    setAttrs(feBlend, { in: 'SourceGraphic', in2: 'blurOut', mode: 'normal' });
    filter.appendChild(feBlend);

    defs.appendChild(filter);

    return defs;
  }

  function createNode(cfg: NodeConfig): SVGGElement {
    const g = svgEl('g');
    g.setAttribute('data-node-id', cfg.id);

    // Rounded rect with drop shadow
    const rect = svgEl('rect');
    const rx = cfg.x - cfg.width / 2;
    const ry = cfg.y - cfg.height / 2;
    setAttrs(rect, {
      x: String(rx),
      y: String(ry),
      width: String(cfg.width),
      height: String(cfg.height),
      rx: '8',
      ry: '8',
      fill: THEME.nodeFill,
      stroke: THEME.nodeStroke,
      'stroke-width': '1.5',
      filter: 'url(#drop-shadow)',
    });
    g.appendChild(rect);

    // Icon text (emoji) — positioned above center
    const iconText = svgEl('text');
    setAttrs(iconText, {
      x: String(cfg.x),
      y: String(cfg.y - 6),
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
      'font-size': cfg.id === 'ebs' ? '16' : '22',
      fill: THEME.textFill,
    });
    iconText.textContent = cfg.icon;
    g.appendChild(iconText);

    // Label text — positioned below center
    const labelText = svgEl('text');
    setAttrs(labelText, {
      x: String(cfg.x),
      y: String(cfg.y + cfg.height / 2 - 10),
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
      'font-size': cfg.id === 'ebs' ? '10' : '12',
      'font-weight': '600',
      fill: THEME.textFill,
    });
    labelText.textContent = cfg.label;
    g.appendChild(labelText);

    // Status indicator circle (only for certain nodes)
    if (cfg.hasStatusIndicator) {
      const circle = svgEl('circle');
      setAttrs(circle, {
        cx: String(cfg.x + cfg.width / 2 - 4),
        cy: String(cfg.y - cfg.height / 2 + 4),
        r: '6',
        fill: STATUS_COLORS.unknown,
        class: 'status-indicator',
      });
      circle.style.transition = 'fill 300ms ease';
      g.appendChild(circle);
      indicators.set(cfg.id, circle);
    }

    return g;
  }

  function createEdge(cfg: EdgeConfig): SVGPathElement {
    const path = svgEl('path');
    setAttrs(path, {
      d: cfg.path,
      fill: 'none',
      stroke: THEME.edgeStroke,
      'stroke-width': '1.5',
      'stroke-opacity': THEME.edgeOpacity,
      'marker-end': 'url(#arrowhead)',
    });
    path.setAttribute('data-edge', `${cfg.from}-${cfg.to}`);
    return path;
  }

  function createEbsUsageCounter(): SVGTextElement {
    const text = svgEl('text');
    const ebsNode = NODES.find((n) => n.id === 'ebs')!;
    setAttrs(text, {
      x: String(ebsNode.x),
      y: String(ebsNode.y + ebsNode.height / 2 + 16),
      'text-anchor': 'middle',
      'font-size': '12',
      'font-weight': '700',
      fill: THEME.textFill,
      class: 'ebs-usage',
    });
    text.textContent = '—%';
    return text;
  }

  /* ---- public API ---- */

  function render(container: HTMLElement): void {
    const svg = svgEl('svg');
    setAttrs(svg, {
      viewBox: '0 0 900 400',
      preserveAspectRatio: 'xMidYMid meet',
    });

    // Defs (arrowhead + drop shadow)
    svg.appendChild(createDefs());

    // Edges (rendered first so nodes draw on top)
    for (const edge of EDGES) {
      svg.appendChild(createEdge(edge));
    }

    // Nodes
    for (const node of NODES) {
      svg.appendChild(createNode(node));
    }

    // EBS usage counter
    ebsUsageText = createEbsUsageCounter();
    svg.appendChild(ebsUsageText);

    container.appendChild(svg);
  }

  function updateNodeStatus(componentId: ComponentId, status: NodeHealthState): void {
    const circle = indicators.get(componentId);
    if (!circle) return; // silently ignore invalid or non-indicator componentIds
    circle.setAttribute('fill', STATUS_COLORS[status]);
  }

  function updateEbsUsage(percent: number | null): void {
    if (!ebsUsageText) return;

    if (percent === null || Number.isNaN(percent)) {
      ebsUsageText.textContent = '—%';
      ebsUsageText.classList.remove('ebs-usage--critical');
      return;
    }

    ebsUsageText.textContent = `${percent}%`;

    if (percent > 80) {
      ebsUsageText.classList.add('ebs-usage--critical');
    } else {
      ebsUsageText.classList.remove('ebs-usage--critical');
    }
  }

  return { render, updateNodeStatus, updateEbsUsage };
}
