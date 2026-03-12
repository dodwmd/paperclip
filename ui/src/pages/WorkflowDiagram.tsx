import { useEffect, useRef, useState, useCallback } from "react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { GitBranch, X } from "lucide-react";

// ── Layout constants ──────────────────────────────────────────────────────────

const CARD_W = 200;
const CARD_H = 108;
const GAP_X = 48;
const GAP_Y = 72;
const PADDING = 60;

const ROW1_Y = PADDING;
const ROW2_Y = ROW1_Y + CARD_H + GAP_Y;

function colX(i: number) {
  return PADDING + i * (CARD_W + GAP_X);
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface RoleDetail {
  role: string;
  bullets: string[];
}

interface WFNode {
  id: string;
  label: string;
  emoji: string;
  owner: string;
  action: string;
  color: string;
  x: number;
  y: number;
  details: RoleDetail[];
}

type EdgeKind = "forward" | "back-arc" | "down" | "up-back";

interface WFEdge {
  from: string;
  to: string;
  label?: string;
  dashed?: boolean;
  kind: EdgeKind;
  arcDepth?: number;
}

// ── Static workflow data ──────────────────────────────────────────────────────

const NODES: WFNode[] = [
  {
    id: "backlog",
    label: "Backlog",
    emoji: "📥",
    owner: "Product Owner",
    action: "Intake & describe",
    color: "#6b7280",
    x: colX(0),
    y: ROW1_Y,
    details: [
      {
        role: "Product Owner",
        bullets: [
          "Every piece of incoming work lands here first",
          "Write a clear title, describe the issue and why it matters",
          "Tag with project, type (Bug / Feature / Platform / Tech Debt), and priority P1–P3",
          "Do NOT assign or estimate — leave that to the Tech Lead",
          "Don't log a ticket without enough detail — get the context first",
        ],
      },
      {
        role: "Tech Lead",
        bullets: [
          "Review new Backlog tickets once daily (async, 10–15 min, no meeting)",
          "Ask: is there enough here to act on?",
          "Identify which squad or individual it belongs to",
          "Note technical risks, dependencies, and architectural implications",
          "Flag shared component or platform tickets for higher priority",
          "When satisfied the ticket is understood, move it to Todo",
        ],
      },
    ],
  },
  {
    id: "todo",
    label: "Todo",
    emoji: "📋",
    owner: "Tech Lead",
    action: "Refine & write criteria",
    color: "#3b82f6",
    x: colX(1),
    y: ROW1_Y,
    details: [
      {
        role: "Tech Lead",
        bullets: [
          "Refinement queue — work through async, no meeting needed",
          "Add acceptance criteria: a short bullet list of what 'done' looks like",
          "Tag designer if design is needed; leave here until assets arrive",
          "Note hard dependencies; leave here until unblocked",
          "Move to Ready once AC is written and dependencies are clear",
        ],
      },
      {
        role: "Product Owner",
        bullets: [
          "Review acceptance criteria and confirm they match intent",
          "Comment if something is missing — do not move the ticket forward",
          "You do NOT move tickets out of Todo — that's the Tech Lead's call",
        ],
      },
    ],
  },
  {
    id: "ready",
    label: "Ready",
    emoji: "✅",
    owner: "Tech Lead / Developer",
    action: "Prioritise / self-assign",
    color: "#8b5cf6",
    x: colX(2),
    y: ROW1_Y,
    details: [
      {
        role: "Tech Lead",
        bullets: [
          "Keep at least 5 tickets here at all times",
          "Tickets ordered by priority — top of column = highest priority",
          "If >10 tickets pile up, stop refining and let the team catch up",
        ],
      },
      {
        role: "Developer",
        bullets: [
          "Pull queue — take the top ticket when you finish something",
          "Do not cherry-pick lower-priority tickets without a clear technical reason",
          "Read the full ticket before starting; tag Tech Lead if anything is unclear",
          "Add estimate (story points or hours) if not already set",
          "Move to In Progress and assign to yourself when you begin",
        ],
      },
    ],
  },
  {
    id: "in_progress",
    label: "In Progress",
    emoji: "🛠️",
    owner: "Developer",
    action: "Build & branch",
    color: "#f59e0b",
    x: colX(3),
    y: ROW1_Y,
    details: [
      {
        role: "Developer",
        bullets: [
          "You own every ticket assigned to you here",
          "WIP limit: no more than 2 tickets per developer at once",
          "Work on a feature branch — never directly on main",
          "If you hit a blocker, move to Blocked immediately — do not sit on it",
          "Open a PR and move to In Review when code is complete",
          "Link the PR to the ticket before moving it",
        ],
      },
    ],
  },
  {
    id: "in_review",
    label: "In Review",
    emoji: "👀",
    owner: "Peer Developer + Tech Lead",
    action: "Review & approve PR",
    color: "#f97316",
    x: colX(4),
    y: ROW1_Y,
    details: [
      {
        role: "Developer (Reviewer)",
        bullets: [
          "WIP limit on this column is 4 — if full, review before picking up new work",
          "Complete reviews within 4 working hours; do not let PRs sit overnight",
          "Review for correctness, architecture adherence, security, and readability",
          "If changes are needed, comment on the PR and move back to In Progress",
          "Shared component or platform tickets require Tech Lead approval too",
        ],
      },
      {
        role: "Tech Lead",
        bullets: [
          "Final approver on shared components, platform, and Workers functions",
          "Do not approve tickets that bypass architecture standards",
          "Standard single-project tickets only need peer review — no need to be involved",
        ],
      },
      {
        role: "Developer (Author)",
        bullets: [
          "Respond to review comments promptly — do not leave a PR in limbo",
          "Once approved, move to QA (do not merge yourself unless you are the deployer)",
        ],
      },
    ],
  },
  {
    id: "qa",
    label: "QA",
    emoji: "🧪",
    owner: "QA Engineer",
    action: "Test acceptance criteria",
    color: "#14b8a6",
    x: colX(5),
    y: ROW1_Y,
    details: [
      {
        role: "QA Engineer",
        bullets: [
          "Test against every acceptance criteria bullet — not just the happy path",
          "For bug fixes, verify the original issue is resolved and check for regressions",
          "For shared component tickets, run a broader regression sweep",
          "If it fails, move back to In Progress with clear, specific notes on what failed",
          "If it passes, add a short QA note and move to Deploy",
        ],
      },
    ],
  },
  {
    id: "deploy",
    label: "Deploy",
    emoji: "🚀",
    owner: "DevOps",
    action: "Pipeline, push to prod",
    color: "#22c55e",
    x: colX(6),
    y: ROW1_Y,
    details: [
      {
        role: "DevOps / Platform Engineer",
        bullets: [
          "Monitor continuously — tickets should not sit here for more than a few hours",
          "Trigger the deployment pipeline: CI/CD builds, pushes HTML to R2, deploys Workers",
          "Confirm the smoke test passes post-deploy",
          "If deployment fails, move back to QA with details of the failure",
          "Confirm feature flag state in KV if applicable",
          "Once live and confirmed, move to Done",
        ],
      },
      {
        role: "Developer",
        bullets: [
          "You are NOT responsible for triggering deployments — that belongs to DevOps",
          "If your ticket has been here >1 day with no action, tag DevOps in the ticket",
        ],
      },
    ],
  },
  {
    id: "done",
    label: "Done",
    emoji: "✔️",
    owner: "Product Owner + Tech Lead",
    action: "Confirm & scan patterns",
    color: "#16a34a",
    x: colX(7),
    y: ROW1_Y,
    details: [
      {
        role: "Product Owner",
        bullets: [
          "Review Done tickets at the end of each week",
          "Confirm the outcome matches what was originally requested",
          "If something was missed, raise a NEW ticket — do not reopen Done tickets",
        ],
      },
      {
        role: "Tech Lead",
        bullets: [
          "Scan Done tickets weekly for patterns",
          "Look for recurring bug types, slow-moving areas, architecture pain points",
          "Feed systemic issues back into Backlog as Tech Debt tickets",
        ],
      },
    ],
  },
  {
    id: "blocked",
    label: "Blocked",
    emoji: "🔴",
    owner: "Developer / Tech Lead",
    action: "Unblock within 2 hours",
    color: "#ef4444",
    x: colX(3),
    y: ROW2_Y,
    details: [
      {
        role: "Developer",
        bullets: [
          "Move here the MOMENT you are blocked — do not sit on it in In Progress",
          "Write a clear comment: exactly what is blocking you and what you need",
          "Tag the relevant person in the comment — Tech Lead, PO, or another developer",
          "Pick up another Ready ticket while waiting — do not go idle",
        ],
      },
      {
        role: "Tech Lead",
        bullets: [
          "You are responsible for unblocking — respond within 2 hours",
          "Once unblocked, ticket moves back to In Progress and developer is notified",
          "If a ticket has been Blocked for >2 days, escalate — something structural is wrong",
        ],
      },
    ],
  },
  {
    id: "cancelled",
    label: "Cancelled",
    emoji: "🚫",
    owner: "Product Owner",
    action: "Archive with reason",
    color: "#9ca3af",
    x: colX(7),
    y: ROW2_Y,
    details: [
      {
        role: "Product Owner",
        bullets: [
          "You own cancellations — move from any column with a one-line reason",
          "Do not delete tickets — Cancelled is your audit trail",
        ],
      },
      {
        role: "Tech Lead",
        bullets: [
          "Flag Product Owner before cancelling in-progress work",
          "Do not cancel work unilaterally",
          "Ensure any incomplete branches are cleaned up after cancellation",
        ],
      },
    ],
  },
];

const EDGES: WFEdge[] = [
  // Main forward flow
  { from: "backlog", to: "todo", kind: "forward" },
  { from: "todo", to: "ready", kind: "forward" },
  { from: "ready", to: "in_progress", kind: "forward" },
  { from: "in_progress", to: "in_review", kind: "forward" },
  { from: "in_review", to: "qa", kind: "forward" },
  { from: "qa", to: "deploy", kind: "forward" },
  { from: "deploy", to: "done", kind: "forward" },
  // Back arcs
  { from: "in_review", to: "in_progress", kind: "back-arc", dashed: true, arcDepth: 60, label: "needs changes" },
  { from: "qa", to: "in_progress", kind: "back-arc", dashed: true, arcDepth: 80, label: "failed QA" },
  { from: "deploy", to: "qa", kind: "back-arc", dashed: true, arcDepth: 60, label: "deploy fail" },
  // Blocked ↔ In Progress
  { from: "in_progress", to: "blocked", kind: "down" },
  { from: "blocked", to: "in_progress", kind: "up-back", dashed: true },
];

// ── Diagram bounds ────────────────────────────────────────────────────────────

const SVG_W = colX(7) + CARD_W + PADDING;
const SVG_H = ROW2_Y + CARD_H + PADDING;

// ── Edge path computation ─────────────────────────────────────────────────────

interface EdgePath {
  d: string;
  dashed: boolean;
  labelX?: number;
  labelY?: number;
}

function computeEdgePath(edge: WFEdge): EdgePath {
  const src = NODES.find((n) => n.id === edge.from)!;
  const tgt = NODES.find((n) => n.id === edge.to)!;
  const dashed = edge.dashed ?? false;

  if (edge.kind === "forward") {
    return {
      d: `M ${src.x + CARD_W} ${src.y + CARD_H / 2} L ${tgt.x} ${tgt.y + CARD_H / 2}`,
      dashed,
    };
  }

  if (edge.kind === "back-arc") {
    const d = edge.arcDepth ?? 60;
    const x1 = src.x + CARD_W / 2;
    const y1 = src.y + CARD_H;
    const x2 = tgt.x + CARD_W / 2;
    const y2 = tgt.y;
    // Cubic bezier: exit bottom of src, arc below, enter top of tgt
    return {
      d: `M ${x1} ${y1} C ${x1} ${y1 + d} ${x2} ${y1 + d} ${x2} ${y2}`,
      dashed,
      labelX: (x1 + x2) / 2,
      labelY: y1 + d * 0.82,
    };
  }

  if (edge.kind === "down") {
    const x = src.x + CARD_W / 2 - 8;
    return {
      d: `M ${x} ${src.y + CARD_H} L ${x} ${tgt.y}`,
      dashed,
    };
  }

  // up-back
  const x = tgt.x + CARD_W / 2 + 8;
  return {
    d: `M ${x} ${src.y} L ${x} ${tgt.y + CARD_H}`,
    dashed,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export function WorkflowDiagram() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Workflow" }]);
  }, [setBreadcrumbs]);

  const selectedNode = selectedId ? (NODES.find((n) => n.id === selectedId) ?? null) : null;

  // Pan & zoom
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const hasInitialized = useRef(false);

  useEffect(() => {
    if (hasInitialized.current || !containerRef.current) return;
    hasInitialized.current = true;
    const cW = containerRef.current.clientWidth;
    const cH = containerRef.current.clientHeight;
    const scaleX = (cW - 40) / SVG_W;
    const scaleY = (cH - 40) / SVG_H;
    const fitZoom = Math.min(scaleX, scaleY, 1);
    setZoom(fitZoom);
    setPan({
      x: (cW - SVG_W * fitZoom) / 2,
      y: (cH - SVG_H * fitZoom) / 2,
    });
  }, []);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("[data-wf-card]")) return;
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
    },
    [pan],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging) return;
      setPan({
        x: dragStart.current.panX + (e.clientX - dragStart.current.x),
        y: dragStart.current.panY + (e.clientY - dragStart.current.y),
      });
    },
    [dragging],
  );

  const handleMouseUp = useCallback(() => setDragging(false), []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = Math.min(Math.max(zoom * factor, 0.15), 2);
      const scale = newZoom / zoom;
      setPan({
        x: mouseX - scale * (mouseX - pan.x),
        y: mouseY - scale * (mouseY - pan.y),
      });
      setZoom(newZoom);
    },
    [zoom, pan],
  );

  function fitToScreen() {
    if (!containerRef.current) return;
    const cW = containerRef.current.clientWidth;
    const cH = containerRef.current.clientHeight;
    const scaleX = (cW - 40) / SVG_W;
    const scaleY = (cH - 40) / SVG_H;
    const fitZoom = Math.min(scaleX, scaleY, 1);
    setZoom(fitZoom);
    setPan({
      x: (cW - SVG_W * fitZoom) / 2,
      y: (cH - SVG_H * fitZoom) / 2,
    });
  }

  const edgePaths = EDGES.map((edge) => ({ edge, ...computeEdgePath(edge) }));

  return (
    <div className="flex gap-2 h-[calc(100vh-4rem)] overflow-hidden">
      {/* Canvas */}
      <div
        ref={containerRef}
        className="flex-1 relative bg-muted/20 border border-border rounded-lg overflow-hidden"
        style={{ cursor: dragging ? "grabbing" : "grab" }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        {/* Zoom controls */}
        <div className="absolute top-3 right-3 z-10 flex flex-col gap-1">
          <button
            className="w-7 h-7 flex items-center justify-center bg-background border border-border rounded text-sm hover:bg-accent transition-colors"
            onClick={() => {
              const newZoom = Math.min(zoom * 1.2, 2);
              if (containerRef.current) {
                const cx = containerRef.current.clientWidth / 2;
                const cy = containerRef.current.clientHeight / 2;
                const scale = newZoom / zoom;
                setPan({ x: cx - scale * (cx - pan.x), y: cy - scale * (cy - pan.y) });
              }
              setZoom(newZoom);
            }}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            className="w-7 h-7 flex items-center justify-center bg-background border border-border rounded text-sm hover:bg-accent transition-colors"
            onClick={() => {
              const newZoom = Math.max(zoom * 0.8, 0.15);
              if (containerRef.current) {
                const cx = containerRef.current.clientWidth / 2;
                const cy = containerRef.current.clientHeight / 2;
                const scale = newZoom / zoom;
                setPan({ x: cx - scale * (cx - pan.x), y: cy - scale * (cy - pan.y) });
              }
              setZoom(newZoom);
            }}
            aria-label="Zoom out"
          >
            &minus;
          </button>
          <button
            className="w-7 h-7 flex items-center justify-center bg-background border border-border rounded text-[10px] hover:bg-accent transition-colors"
            onClick={fitToScreen}
            title="Fit to screen"
            aria-label="Fit to screen"
          >
            Fit
          </button>
        </div>

        {/* Legend */}
        <div className="absolute bottom-3 left-3 z-10 flex items-center gap-4 bg-background/80 backdrop-blur-sm border border-border rounded px-3 py-1.5 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-5 border-t border-border" />
            forward
          </span>
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block w-5 border-t border-muted-foreground/50"
              style={{ borderTopStyle: "dashed" }}
            />
            back / return
          </span>
          <span className="flex items-center gap-1">
            <GitBranch className="h-3 w-3" />
            click card for role details
          </span>
        </div>

        {/* SVG edge layer */}
        <svg className="absolute inset-0 pointer-events-none" style={{ width: "100%", height: "100%" }}>
          <defs>
            <marker id="wf-arrow" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
              <polygon points="0 0, 10 3.5, 0 7" fill="var(--border)" />
            </marker>
            <marker
              id="wf-arrow-muted"
              markerWidth="10"
              markerHeight="7"
              refX="10"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 10 3.5, 0 7" fill="var(--muted-foreground)" opacity="0.5" />
            </marker>
          </defs>
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
            {edgePaths.map(({ edge, d, dashed, labelX, labelY }) => (
              <g key={`${edge.from}-${edge.to}`}>
                <path
                  d={d}
                  fill="none"
                  stroke={dashed ? "var(--muted-foreground)" : "var(--border)"}
                  strokeWidth={1.5}
                  strokeDasharray={dashed ? "5 3" : undefined}
                  markerEnd={`url(#${dashed ? "wf-arrow-muted" : "wf-arrow"})`}
                  opacity={dashed ? 0.65 : 1}
                />
                {edge.label && labelX !== undefined && labelY !== undefined && (
                  <g>
                    <rect
                      x={labelX - 38}
                      y={labelY - 8}
                      width={76}
                      height={16}
                      rx={3}
                      fill="var(--background)"
                      stroke="var(--border)"
                      strokeWidth={0.5}
                    />
                    <text
                      x={labelX}
                      y={labelY + 4}
                      textAnchor="middle"
                      fontSize={9}
                      fill="var(--muted-foreground)"
                      fontFamily="inherit"
                    >
                      {edge.label}
                    </text>
                  </g>
                )}
              </g>
            ))}
          </g>
        </svg>

        {/* Card layer */}
        <div
          className="absolute inset-0"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        >
          {NODES.map((node) => (
            <div
              key={node.id}
              data-wf-card
              className={`absolute bg-card rounded-lg shadow-sm cursor-pointer select-none transition-[box-shadow,border-color] duration-150 hover:shadow-md ${
                selectedId === node.id
                  ? "border-2 shadow-md"
                  : "border border-border hover:border-foreground/20"
              }`}
              style={{
                left: node.x,
                top: node.y,
                width: CARD_W,
                height: CARD_H,
                borderLeftWidth: selectedId === node.id ? 4 : 3,
                borderLeftColor: node.color,
                borderLeftStyle: "solid",
                ...(selectedId === node.id
                  ? { borderColor: node.color + "66", borderLeftColor: node.color }
                  : {}),
              }}
              onClick={() => setSelectedId(selectedId === node.id ? null : node.id)}
            >
              <div className="flex flex-col h-full px-3 py-2.5 justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-base leading-none">{node.emoji}</span>
                  <span className="text-sm font-semibold text-foreground leading-tight">
                    {node.label}
                  </span>
                </div>
                <div>
                  <div className="text-[10px] text-muted-foreground/60 leading-tight truncate">
                    {node.owner}
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-snug mt-0.5 truncate">
                    {node.action}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detail panel */}
      {selectedNode && (
        <div className="w-72 shrink-0 border border-border rounded-lg bg-background flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-lg leading-none">{selectedNode.emoji}</span>
              <h2 className="text-sm font-semibold" style={{ color: selectedNode.color }}>
                {selectedNode.label}
              </h2>
            </div>
            <button
              className="text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setSelectedId(null)}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-5">
            {selectedNode.details.map((detail) => (
              <div key={detail.role}>
                <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {detail.role}
                </div>
                <ul className="space-y-2">
                  {detail.bullets.map((bullet, i) => (
                    <li key={i} className="flex gap-2 text-[12px] text-foreground/80 leading-snug">
                      <span
                        className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: selectedNode.color + "99" }}
                      />
                      {bullet}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
