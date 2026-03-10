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
import { AlertTriangle } from "lucide-react";
import { StatusIcon } from "./StatusIcon";
import { PriorityIcon } from "./PriorityIcon";
import { Identity } from "./Identity";
import type { Issue } from "@paperclipai/shared";

/* ── Column config ── */

type ColumnConfig = {
  status: string;
  wipLimit?: number;         // global item count limit
  wipPerAssignee?: number;   // per-assignee limit
};

const BOARD_COLUMNS: ColumnConfig[] = [
  { status: "backlog" },
  { status: "todo" },
  { status: "ready", wipLimit: 10 },
  { status: "in_progress", wipPerAssignee: 2 },
  { status: "in_review", wipLimit: 4 },
  { status: "qa", wipLimit: 4 },
  { status: "deploy" },
  { status: "done" },
];

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface Agent {
  id: string;
  name: string;
}

interface KanbanBoardProps {
  issues: Issue[];
  agents?: Agent[];
  liveIssueIds?: Set<string>;
  onUpdateIssue: (id: string, data: Record<string, unknown>) => void;
}

/* ── Droppable Column ── */

function KanbanColumn({
  config,
  issues,
  agents,
  liveIssueIds,
}: {
  config: ColumnConfig;
  issues: Issue[];
  agents?: Agent[];
  liveIssueIds?: Set<string>;
}) {
  const { status, wipLimit, wipPerAssignee } = config;
  const { setNodeRef, isOver } = useDroppable({ id: status });

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

  return (
    <div className="flex flex-col min-w-[260px] w-[260px] shrink-0">
      <div className="flex items-center gap-2 px-2 py-2 mb-1">
        <StatusIcon status={status} />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {statusLabel(status)}
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
          items={issues.map((i) => i.id)}
          strategy={verticalListSortingStrategy}
        >
          {issues.map((issue) => (
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
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
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
            return name ? (
              <Identity name={name} size="xs" />
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
}: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const columnIssues = useMemo(() => {
    const grouped: Record<string, Issue[]> = {};
    for (const col of BOARD_COLUMNS) {
      grouped[col.status] = [];
    }
    for (const issue of issues) {
      if (grouped[issue.status]) {
        grouped[issue.status].push(issue);
      }
    }
    return grouped;
  }, [issues]);

  const activeIssue = useMemo(
    () => (activeId ? issues.find((i) => i.id === activeId) : null),
    [activeId, issues]
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const issueId = active.id as string;
    const issue = issues.find((i) => i.id === issueId);
    if (!issue) return;

    // Determine target status: "over" could be a column id (status string) or a card id
    let targetStatus: string | null = null;

    if (BOARD_COLUMNS.some((c) => c.status === over.id)) {
      targetStatus = over.id as string;
    } else {
      // It's a card — find which column it's in
      const targetIssue = issues.find((i) => i.id === over.id);
      if (targetIssue) {
        targetStatus = targetIssue.status;
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
    >
      <div className="flex gap-3 overflow-x-auto pb-4 -mx-2 px-2">
        {BOARD_COLUMNS.map((col) => (
          <KanbanColumn
            key={col.status}
            config={col}
            issues={columnIssues[col.status] ?? []}
            agents={agents}
            liveIssueIds={liveIssueIds}
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
