import { useMemo, useState } from "react";
import { Link } from "@/lib/router";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import { StatusIcon } from "./StatusIcon";
import { PriorityIcon } from "./PriorityIcon";
import { Identity } from "./Identity";
import type { Issue, KanbanConfig } from "@paperclipai/shared";
import { AGENT_ROLE_LABELS, resolveKanbanConfig } from "@paperclipai/shared";
import { useToast } from "../context/ToastContext";

const COLUMN_TRUNCATE_LIMIT = 5;

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface Agent {
  id: string;
  name: string;
  role?: string;
}

interface KanbanBoardProps {
  issues: Issue[];
  agents?: Agent[];
  liveIssueIds?: Set<string>;
  onUpdateIssue: (id: string, data: Record<string, unknown>) => void;
  /** When true (search/filters active), disables done/cancelled truncation */
  isFiltered?: boolean;
  /** Company-specific kanban config; null/undefined uses system defaults */
  kanbanConfig?: KanbanConfig | null;
}

/* ── ColumnConfig (internal, derived from ColumnDefinition) ── */

type ColumnConfig = {
  status: string;
  label?: string;
  wipLimit?: number;
  wipPerAssignee?: number;
  truncateByDefault?: boolean;
};

/* ── Droppable Column ── */

function KanbanColumn({
  config,
  issues,
  agents,
  liveIssueIds,
  isFiltered,
  isDimmedDuringDrag,
}: {
  config: ColumnConfig;
  issues: Issue[];
  agents?: Agent[];
  liveIssueIds?: Set<string>;
  isFiltered?: boolean;
  isDimmedDuringDrag?: boolean;
}) {
  const { status, wipLimit, wipPerAssignee } = config;
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const [showAll, setShowAll] = useState(false);

  // Global WIP check
  const isOverGlobalLimit = wipLimit != null && issues.length > wipLimit;

  // Per-assignee WIP check
  const overLimitAssignees = useMemo<Set<string>>(() => {
    if (!wipPerAssignee) return new Set();
    const counts: Record<string, number> = {};
    for (const issue of issues) {
      if (issue.assigneeAgentId) {
        counts[issue.assigneeAgentId] = (counts[issue.assigneeAgentId] ?? 0) + 1;
      }
    }
    return new Set(
      Object.entries(counts)
        .filter(([, count]) => count > wipPerAssignee)
        .map(([id]) => id)
    );
  }, [issues, wipPerAssignee]);

  const isOverPerAssignee = overLimitAssignees.size > 0;
  const isOverLimit = isOverGlobalLimit || isOverPerAssignee;

  const countDisplay = wipLimit != null
    ? `${issues.length} / ${wipLimit}`
    : `${issues.length}`;

  // Truncation: for columns marked truncateByDefault when no search/filter is active
  const canTruncate = config.truncateByDefault === true && !isFiltered;
  const isTruncated = canTruncate && !showAll && issues.length > COLUMN_TRUNCATE_LIMIT;
  const displayedIssues = isTruncated ? issues.slice(0, COLUMN_TRUNCATE_LIMIT) : issues;
  const hiddenCount = isTruncated ? issues.length - COLUMN_TRUNCATE_LIMIT : 0;

  // Empty column: render as a compact narrow strip, still droppable
  if (issues.length === 0) {
    return (
      <div
        ref={setNodeRef}
        className={`flex flex-col items-center min-w-[56px] w-[56px] shrink-0 rounded-md transition-all duration-200 ${
          isOver
            ? "bg-accent/50 border-2 border-accent/60 min-h-[160px]"
            : "bg-muted/10 border border-dashed border-border/40 min-h-[120px]"
        } ${isDimmedDuringDrag ? "opacity-30" : ""}`}
      >
        <div className="flex flex-col items-center gap-1.5 p-2 pt-3">
          <StatusIcon status={status} />
          <span
            className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/40 my-1.5"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            {config.label ?? statusLabel(status)}
          </span>
          <span className="text-[10px] text-muted-foreground/30 tabular-nums">0</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col min-w-[240px] w-[240px] shrink-0 transition-opacity duration-200 ${isDimmedDuringDrag ? "opacity-30" : ""}`}>
      <div className="flex items-center gap-2 px-2 py-2 mb-1">
        <StatusIcon status={status} />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {config.label ?? statusLabel(status)}
        </span>
        <span
          className={`text-xs ml-auto tabular-nums font-medium ${
            isOverLimit ? "text-red-500 dark:text-red-400" : "text-muted-foreground/60"
          }`}
        >
          {countDisplay}
        </span>
        {isOverLimit && (
          <AlertTriangle className="h-3 w-3 text-red-500 dark:text-red-400 shrink-0" />
        )}
      </div>

      {/* Expand control for truncated columns */}
      {hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-1 px-2 py-1 hover:bg-accent/30 rounded transition-colors"
        >
          <ChevronDown className="h-3 w-3 shrink-0" />
          +{hiddenCount} older issues
        </button>
      )}

      <div
        ref={setNodeRef}
        className={`flex-1 min-h-[120px] rounded-md p-1 space-y-1 transition-colors ${
          isOver
            ? "bg-accent/40"
            : isOverLimit
              ? "bg-red-500/10 border border-red-500/20"
              : "bg-muted/20"
        }`}
      >
        <SortableContext
          items={displayedIssues.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          {displayedIssues.map((issue) => (
            <KanbanCard
              key={issue.id}
              issue={issue}
              agents={agents}
              isLive={liveIssueIds?.has(issue.id)}
              isWipViolating={
                issue.assigneeAgentId
                  ? overLimitAssignees.has(issue.assigneeAgentId)
                  : false
              }
            />
          ))}
        </SortableContext>
      </div>

      {/* Collapse control when expanded */}
      {showAll && canTruncate && issues.length > COLUMN_TRUNCATE_LIMIT && (
        <button
          onClick={() => setShowAll(false)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1 px-2 py-1 hover:bg-accent/30 rounded transition-colors"
        >
          <ChevronUp className="h-3 w-3 shrink-0" />
          Show less
        </button>
      )}
    </div>
  );
}

/* ── Draggable Card ── */

function KanbanCard({
  issue,
  agents,
  isLive,
  isOverlay,
  isWipViolating,
}: {
  issue: Issue;
  agents?: Agent[];
  isLive?: boolean;
  isOverlay?: boolean;
  isWipViolating?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: issue.id, data: { issue } });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const agentName = (id: string | null) => {
    if (!id || !agents) return null;
    return agents.find((a) => a.id === id)?.name ?? null;
  };

  const agentRole = (id: string | null) => {
    if (!id || !agents) return null;
    const agent = agents.find((a) => a.id === id);
    return agent?.role ?? null;
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`rounded-md border bg-card p-2.5 cursor-grab active:cursor-grabbing transition-shadow ${
        isDragging && !isOverlay ? "opacity-30" : ""
      } ${isOverlay ? "shadow-lg ring-1 ring-primary/20" : "hover:shadow-sm"} ${
        isWipViolating ? "border-l-2 border-l-amber-500" : ""
      }`}
    >
      <Link
        to={`/issues/${issue.identifier ?? issue.id}`}
        className="block no-underline text-inherit"
        onClick={(e) => {
          // Prevent navigation during drag
          if (isDragging) e.preventDefault();
        }}
      >
        <div className="flex items-start gap-1.5 mb-1.5">
          <span className="text-xs text-muted-foreground font-mono shrink-0">
            {issue.identifier ?? issue.id.slice(0, 8)}
          </span>
          {isLive && (
            <span className="relative flex h-2 w-2 shrink-0 mt-0.5">
              <span className="animate-pulse absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
            </span>
          )}
          {isWipViolating && (
            <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5 ml-auto" />
          )}
        </div>
        <p className="text-sm leading-snug line-clamp-2 mb-2">{issue.title}</p>
        <div className="flex items-center gap-2">
          <PriorityIcon priority={issue.priority} />
          {issue.assigneeAgentId && (() => {
            const name = agentName(issue.assigneeAgentId);
            const role = agentRole(issue.assigneeAgentId);
            const roleLabel = role && role in AGENT_ROLE_LABELS
              ? AGENT_ROLE_LABELS[role as keyof typeof AGENT_ROLE_LABELS]
              : null;
            return name ? (
              <div className="flex items-center gap-1">
                <Identity name={name} size="xs" />
                {roleLabel && (
                  <span className="text-[10px] text-muted-foreground bg-muted px-1 rounded">
                    {roleLabel}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground font-mono">
                {issue.assigneeAgentId.slice(0, 8)}
              </span>
            );
          })()}
        </div>
      </Link>
    </div>
  );
}

/* ── Main Board ── */

export function KanbanBoard({
  issues,
  agents,
  liveIssueIds,
  onUpdateIssue,
  isFiltered,
  kanbanConfig,
}: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draggingStatus, setDraggingStatus] = useState<string | null>(null);
  const { pushToast } = useToast();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  // Resolve effective config (custom or system defaults)
  const effectiveConfig = useMemo(() => resolveKanbanConfig(kanbanConfig ?? null), [kanbanConfig]);

  // Map ColumnDefinition → internal ColumnConfig shape
  const boardColumns: ColumnConfig[] = useMemo(
    () =>
      effectiveConfig.columns.map((col) => ({
        status: col.status,
        label: col.label,
        wipLimit: col.wipGlobalLimit,
        wipPerAssignee: col.wipPerAssigneeLimit,
        truncateByDefault: col.truncateByDefault,
      })),
    [effectiveConfig],
  );

  const columnIssues = useMemo(() => {
    const grouped: Record<string, Issue[]> = {};
    for (const col of boardColumns) {
      grouped[col.status] = [];
    }
    for (const issue of issues) {
      if (grouped[issue.status] !== undefined) {
        grouped[issue.status].push(issue);
      }
    }
    return grouped;
  }, [issues, boardColumns]);

  const activeIssue = useMemo(
    () => (activeId ? issues.find((i) => i.id === activeId) : null),
    [activeId, issues]
  );

  // During drag: set of column statuses the dragged issue can legally move into.
  // The dragged issue's current column is always included (no-op drop).
  const validDragTargets = useMemo(() => {
    if (!draggingStatus) return null;
    return new Set(
      effectiveConfig.rules
        .filter((r) => r.from === draggingStatus)
        .map((r) => r.to)
        .concat([draggingStatus])
    );
  }, [draggingStatus, effectiveConfig.rules]);

  function handleDragStart(event: DragStartEvent) {
    const id = event.active.id as string;
    setActiveId(id);
    const draggedIssue = issues.find((i) => i.id === id);
    if (draggedIssue) setDraggingStatus(draggedIssue.status);
  }

  function handleDragCancel() {
    setActiveId(null);
    setDraggingStatus(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    setDraggingStatus(null);
    const { active, over } = event;
    if (!over) return;

    const issueId = active.id as string;
    const issue = issues.find((i) => i.id === issueId);
    if (!issue) return;

    // Determine target status: "over" could be a column id (status string) or a card id
    let targetStatus: string | null = null;

    if (boardColumns.some((c) => c.status === over.id)) {
      targetStatus = over.id as string;
    } else {
      // It's a card — find which column it's in
      const targetIssue = issues.find((i) => i.id === over.id);
      if (targetIssue) {
        targetStatus = targetIssue.status;
      }
    }

    // Client-side transition guard: check if this transition is defined in the
    // effective rules. This is purely advisory UI feedback; server enforces.
    if (targetStatus && targetStatus !== issue.status) {
      const isDefined = effectiveConfig.rules.some(
        (r) => r.from === issue.status && r.to === targetStatus
      );
      if (!isDefined) {
        // Transition is not defined in the policy — show visible user feedback
        pushToast({
          title: "Transition not allowed",
          body: `Moving from '${issue.status}' to '${targetStatus}' is not a valid workflow transition.`,
          tone: "warn",
        });
        return;
      }
    }

    if (targetStatus && targetStatus !== issue.status) {
      onUpdateIssue(issueId, { status: targetStatus });
    }
  }

  function handleDragOver(_event: DragOverEvent) {
    // Could be used for visual feedback; keeping simple for now
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex gap-3 overflow-x-auto pb-4 -mx-2 px-2 items-start">
        {boardColumns.map((col) => (
          <KanbanColumn
            key={col.status}
            config={col}
            issues={columnIssues[col.status] ?? []}
            agents={agents}
            liveIssueIds={liveIssueIds}
            isFiltered={isFiltered}
            isDimmedDuringDrag={
              draggingStatus !== null &&
              validDragTargets !== null &&
              !validDragTargets.has(col.status)
            }
          />
        ))}
      </div>
      <DragOverlay>
        {activeIssue ? (
          <KanbanCard issue={activeIssue} agents={agents} isOverlay />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
