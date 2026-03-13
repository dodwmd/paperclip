import { useState, useCallback, useMemo } from "react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  GripVertical,
  Trash2,
  Plus,
  Lock,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ColumnDefinition, KanbanConfig, TransitionRule } from "@paperclipai/shared";
import {
  AGENT_ROLES,
  AGENT_ROLE_LABELS,
  DEFAULT_COLUMNS,
  KANBAN_TEMPLATES,
  resolveKanbanConfig,
} from "@paperclipai/shared";
import { useToast } from "../context/ToastContext";

// Built-in status keys that cannot be renamed
const BUILTIN_STATUSES = new Set(DEFAULT_COLUMNS.map((c) => c.status));

interface KanbanConfigEditorProps {
  companyId: string;
  initialConfig: KanbanConfig | null;
  onSave: (config: KanbanConfig | null) => void;
  isSaving: boolean;
  readOnly?: boolean;
}

// ---------------------------------------------------------------------------
// Sortable column row
// ---------------------------------------------------------------------------

function SortableColumnRow({
  col,
  index,
  usedByRules,
  onChange,
  onDelete,
  readOnly,
}: {
  col: ColumnDefinition & { _id: string };
  index: number;
  usedByRules: boolean;
  onChange: (index: number, updates: Partial<ColumnDefinition>) => void;
  onDelete: (index: number) => void;
  readOnly?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: col._id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const isBuiltin = BUILTIN_STATUSES.has(col.status);

  // Auto-derive status from label
  function handleLabelChange(label: string) {
    const updates: Partial<ColumnDefinition> = { label };
    if (!isBuiltin) {
      const derived = label
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, "")
        .trim()
        .replace(/\s+/g, "_")
        .replace(/^([^a-z])/, "x$1"); // ensure starts with letter
      updates.status = derived || col.status;
    }
    onChange(index, updates);
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-start gap-2 rounded-md border border-border bg-card px-2 py-2"
    >
      {/* Drag handle */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        className={`mt-1 cursor-grab text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing${readOnly ? " opacity-50 pointer-events-none" : ""}`}
        aria-label="Drag to reorder"
        disabled={readOnly}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <div className="flex flex-1 flex-wrap gap-2">
        {/* Label */}
        <div className="flex flex-col gap-1 min-w-[120px] flex-1">
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
            Label
          </label>
          <input
            className="rounded border border-border bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary/50"
            value={col.label}
            onChange={(e) => handleLabelChange(e.target.value)}
            placeholder="Column name"
            disabled={readOnly}
          />
        </div>

        {/* Status key */}
        <div className="flex flex-col gap-1 min-w-[120px] flex-1">
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
            Status key
          </label>
          <input
            className={`rounded border border-border px-2 py-1 text-sm font-mono outline-none ${
              isBuiltin
                ? "bg-muted/30 text-muted-foreground cursor-not-allowed"
                : "bg-transparent focus:ring-1 focus:ring-primary/50"
            }`}
            value={col.status}
            readOnly={isBuiltin}
            onChange={(e) => !isBuiltin && onChange(index, { status: e.target.value })}
            placeholder="snake_case_key"
            disabled={readOnly}
          />
        </div>

        {/* WIP Global */}
        <div className="flex flex-col gap-1 w-[80px]">
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
            WIP Global
          </label>
          <input
            className="rounded border border-border bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary/50"
            type="number"
            min={1}
            value={col.wipGlobalLimit ?? ""}
            onChange={(e) =>
              onChange(index, {
                wipGlobalLimit: e.target.value ? Number(e.target.value) : undefined,
              })
            }
            placeholder="∞"
            disabled={readOnly}
          />
        </div>

        {/* WIP Per-Assignee */}
        <div className="flex flex-col gap-1 w-[80px]">
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
            WIP/Agent
          </label>
          <input
            className="rounded border border-border bg-transparent px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary/50"
            type="number"
            min={1}
            value={col.wipPerAssigneeLimit ?? ""}
            onChange={(e) =>
              onChange(index, {
                wipPerAssigneeLimit: e.target.value ? Number(e.target.value) : undefined,
              })
            }
            placeholder="∞"
            disabled={readOnly}
          />
        </div>

        {/* Truncate toggle */}
        <div className="flex flex-col gap-1 w-[72px]">
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
            Truncate
          </label>
          <div className="flex items-center h-[30px]">
            <input
              type="checkbox"
              checked={!!col.truncateByDefault}
              onChange={(e) => onChange(index, { truncateByDefault: e.target.checked })}
              className="h-4 w-4 rounded border-border"
              title="Collapse to 5 items when unfiltered"
              disabled={readOnly}
            />
          </div>
        </div>
      </div>

      {/* Delete */}
      <button
        type="button"
        onClick={() => !usedByRules && !readOnly && onDelete(index)}
        disabled={usedByRules || readOnly}
        title={usedByRules ? "Remove rules referencing this column first" : "Delete column"}
        className={`mt-1 shrink-0 ${
          usedByRules || readOnly
            ? "text-muted-foreground/20 cursor-not-allowed"
            : "text-muted-foreground hover:text-destructive"
        }`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Transition rule row
// ---------------------------------------------------------------------------

function RuleRow({
  rule,
  index,
  columnStatuses,
  onChange,
  onDelete,
  readOnly,
}: {
  rule: TransitionRule & { _id: string };
  index: number;
  columnStatuses: { status: string; label: string }[];
  onChange: (index: number, updates: Partial<TransitionRule>) => void;
  onDelete: (index: number) => void;
  readOnly?: boolean;
}) {
  const hasError =
    rule.from === rule.to ||
    rule.allowedRoles.length === 0;

  function toggleRole(role: string) {
    const has = rule.allowedRoles.includes(role);
    const next = has
      ? rule.allowedRoles.filter((r) => r !== role)
      : [...rule.allowedRoles, role];
    onChange(index, { allowedRoles: next });
  }

  return (
    <div
      className={`flex flex-wrap items-start gap-3 rounded-md border bg-card px-3 py-2.5 ${
        hasError ? "border-red-500/50 bg-red-500/5" : "border-border"
      }`}
    >
      {/* From → To */}
      <div className="flex items-center gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
            From
          </label>
          <select
            className="rounded border border-border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary/50"
            value={rule.from}
            onChange={(e) => onChange(index, { from: e.target.value })}
            disabled={readOnly}
          >
            {columnStatuses.map((c) => (
              <option key={c.status} value={c.status}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <span className="mt-5 text-muted-foreground text-sm">→</span>
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
            To
          </label>
          <select
            className={`rounded border px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-primary/50 ${
              rule.from === rule.to
                ? "border-red-500 bg-background"
                : "border-border bg-background"
            }`}
            value={rule.to}
            onChange={(e) => onChange(index, { to: e.target.value })}
            disabled={readOnly}
          >
            {columnStatuses.map((c) => (
              <option key={c.status} value={c.status}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Allowed Roles */}
      <div className="flex flex-col gap-1 flex-1 min-w-[180px]">
        <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
          Allowed Roles
          {rule.allowedRoles.length === 0 && (
            <span className="ml-1 text-red-500">(required)</span>
          )}
        </label>
        <div className="flex flex-wrap gap-1">
          {AGENT_ROLES.map((role) => {
            const active = rule.allowedRoles.includes(role);
            return (
              <button
                key={role}
                type="button"
                onClick={() => !readOnly && toggleRole(role)}
                disabled={readOnly}
                className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
                  active
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }${readOnly ? " cursor-not-allowed opacity-60" : ""}`}
              >
                {AGENT_ROLE_LABELS[role as keyof typeof AGENT_ROLE_LABELS] ?? role}
              </button>
            );
          })}
        </div>
      </div>

      {/* Extra flags */}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">
          Flags
        </label>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1 text-xs text-muted-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 rounded"
              checked={!!rule.requiredFields?.includes("prUrl")}
              onChange={(e) =>
                onChange(index, {
                  requiredFields: e.target.checked ? ["prUrl"] : [],
                })
              }
              disabled={readOnly}
            />
            Needs PR URL
          </label>
          <button
            type="button"
            onClick={() => !readOnly && onChange(index, { strict: !rule.strict })}
            disabled={readOnly}
            title={rule.strict ? "Strict (on)" : "Strict (off)"}
            className={`transition-colors ${
              rule.strict ? "text-primary" : "text-muted-foreground/40 hover:text-muted-foreground"
            }${readOnly ? " cursor-not-allowed opacity-60" : ""}`}
          >
            <Lock className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Delete */}
      <button
        type="button"
        onClick={() => !readOnly && onDelete(index)}
        disabled={readOnly}
        className={`mt-5 shrink-0 ${readOnly ? "text-muted-foreground/20 cursor-not-allowed" : "text-muted-foreground hover:text-destructive"}`}
        title="Remove rule"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main editor
// ---------------------------------------------------------------------------

function uid() {
  return `_${Math.random().toString(36).slice(2)}`;
}

type ColWithId = ColumnDefinition & { _id: string };
type RuleWithId = TransitionRule & { _id: string };

export function KanbanConfigEditor({
  initialConfig,
  onSave,
  isSaving,
  readOnly = false,
}: KanbanConfigEditorProps) {
  const { pushToast } = useToast();
  const effective = useMemo(
    () => resolveKanbanConfig(initialConfig),
    [initialConfig],
  );

  const [columns, setColumns] = useState<ColWithId[]>(() =>
    effective.columns.map((c) => ({ ...c, _id: uid() })),
  );
  const [rules, setRules] = useState<RuleWithId[]>(() =>
    effective.rules.map((r) => ({ ...r, _id: uid() })),
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Track which column statuses are referenced by rules
  const statusesUsedByRules = useMemo(() => {
    const s = new Set<string>();
    for (const r of rules) {
      s.add(r.from);
      s.add(r.to);
    }
    return s;
  }, [rules]);

  const columnStatuses = useMemo(
    () => columns.map((c) => ({ status: c.status, label: c.label })),
    [columns],
  );

  // Validation
  const errors = useMemo(() => {
    const errs: string[] = [];
    const statuses = new Set(columns.map((c) => c.status));
    const dups = columns.filter(
      (c, i) => columns.findIndex((x) => x.status === c.status) !== i,
    );
    if (dups.length > 0) {
      errs.push(`Duplicate status keys: ${[...new Set(dups.map((d) => d.status))].join(", ")}`);
    }
    for (const r of rules) {
      if (r.from === r.to) errs.push(`Rule from "${r.from}" to itself`);
      if (!statuses.has(r.from)) errs.push(`Rule references unknown column "${r.from}"`);
      if (!statuses.has(r.to)) errs.push(`Rule references unknown column "${r.to}"`);
      if (r.allowedRoles.length === 0) errs.push(`Rule ${r.from}→${r.to} has no allowed roles`);
    }
    return errs;
  }, [columns, rules]);

  const isValid = errors.length === 0 && columns.length > 0;

  // ---------- Column handlers ----------

  function handleColumnDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setColumns((prev) => {
      const oldIdx = prev.findIndex((c) => c._id === active.id);
      const newIdx = prev.findIndex((c) => c._id === over.id);
      return arrayMove(prev, oldIdx, newIdx);
    });
  }

  const handleColumnChange = useCallback(
    (index: number, updates: Partial<ColumnDefinition>) => {
      setColumns((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], ...updates };
        return next;
      });
    },
    [],
  );

  const handleColumnDelete = useCallback((index: number) => {
    setColumns((prev) => prev.filter((_, i) => i !== index));
  }, []);

  function handleAddColumn() {
    setColumns((prev) => {
      const existingStatuses = new Set(prev.map((c) => c.status));
      let status = "new_column";
      let counter = 2;
      while (existingStatuses.has(status)) {
        status = `new_column_${counter}`;
        counter++;
      }
      return [...prev, { _id: uid(), status, label: "New Column" }];
    });
  }

  // ---------- Rule handlers ----------

  const handleRuleChange = useCallback(
    (index: number, updates: Partial<TransitionRule>) => {
      setRules((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], ...updates };
        return next;
      });
    },
    [],
  );

  const handleRuleDelete = useCallback((index: number) => {
    setRules((prev) => prev.filter((_, i) => i !== index));
  }, []);

  function handleAddRule() {
    const first = columns[0]?.status ?? "backlog";
    const second = columns[1]?.status ?? first;
    setRules((prev) => [
      ...prev,
      { _id: uid(), from: first, to: second, allowedRoles: ["engineer"] },
    ]);
  }

  // ---------- Template picker ----------

  function applyTemplate(templateId: string) {
    const tpl = KANBAN_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) {
      pushToast({ title: "Template not found", body: `No template with id "${templateId}" exists.`, tone: "error" });
      return;
    }
    if (!tpl.config.columns.length && !tpl.config.rules.length) {
      pushToast({ title: "Empty template", body: `Template "${tpl.name}" has no columns or rules to apply.`, tone: "warn" });
      return;
    }
    setColumns(tpl.config.columns.map((c) => ({ ...c, _id: uid() })));
    setRules(tpl.config.rules.map((r) => ({ ...r, _id: uid() })));
  }

  // ---------- Save / Reset ----------

  function handleReset() {
    const defaults = resolveKanbanConfig(null);
    setColumns(defaults.columns.map((c) => ({ ...c, _id: uid() })));
    setRules(defaults.rules.map((r) => ({ ...r, _id: uid() })));
  }

  function handleSave() {
    const config: KanbanConfig = {
      columns: columns.map(({ _id: _unused, ...c }) => c),
      rules: rules.map(({ _id: _unused, ...r }) => r),
    };
    onSave(config);
  }

  return (
    <div className="space-y-6">
      {readOnly && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          This config is managed via a git URL and is read-only.
        </p>
      )}
      {/* ── Template picker ── */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Start from a template
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {KANBAN_TEMPLATES.map((tpl) => (
            <button
              key={tpl.id}
              type="button"
              onClick={() => !readOnly && applyTemplate(tpl.id)}
              disabled={readOnly}
              className={`group rounded-md border border-border bg-muted/20 px-3 py-2.5 text-left transition-colors hover:border-primary/50 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50${readOnly ? " opacity-50 cursor-not-allowed" : ""}`}
            >
              <div className="text-xs font-semibold mb-1">{tpl.name}</div>
              <div className="text-[11px] text-muted-foreground mb-2 line-clamp-2">
                {tpl.description}
              </div>
              <div className="flex flex-wrap gap-0.5">
                {tpl.previewColumns.map((col, i) => (
                  <span
                    key={i}
                    className="rounded-sm bg-muted px-1 py-0.5 text-[10px] text-muted-foreground"
                  >
                    {col}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Columns ── */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Columns
        </div>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleColumnDragEnd}
        >
          <SortableContext
            items={columns.map((c) => c._id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-1.5">
              {columns.map((col, i) => (
                <SortableColumnRow
                  key={col._id}
                  col={col}
                  index={i}
                  usedByRules={statusesUsedByRules.has(col.status)}
                  onChange={handleColumnChange}
                  onDelete={handleColumnDelete}
                  readOnly={readOnly}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
        <button
          type="button"
          onClick={handleAddColumn}
          disabled={readOnly}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mt-1 px-2 py-1.5 rounded hover:bg-accent/30 transition-colors disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          Add column
        </button>
      </div>

      {/* ── Transition Rules ── */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Transition rules
        </div>
        <div className="space-y-1.5">
          {rules.length === 0 && (
            <div className="text-xs text-muted-foreground py-2 px-1">
              No rules — all transitions are open. Add rules to restrict who can move issues.
            </div>
          )}
          {rules.map((rule, i) => (
            <RuleRow
              key={rule._id}
              rule={rule}
              index={i}
              columnStatuses={columnStatuses}
              onChange={handleRuleChange}
              onDelete={handleRuleDelete}
              readOnly={readOnly}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={handleAddRule}
          disabled={columns.length < 2 || readOnly}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mt-1 px-2 py-1.5 rounded hover:bg-accent/30 transition-colors disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" />
          Add rule
        </button>
      </div>

      {/* ── Validation errors ── */}
      {errors.length > 0 && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 space-y-1">
          {errors.map((e, i) => (
            <p key={i} className="text-xs text-red-600 dark:text-red-400">
              {e}
            </p>
          ))}
        </div>
      )}

      {/* ── Footer ── */}
      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={isSaving || !isValid || readOnly}
        >
          {isSaving ? "Saving..." : "Save board config"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleReset}
          disabled={isSaving || readOnly}
          className="text-muted-foreground"
        >
          <RotateCcw className="h-3.5 w-3.5 mr-1" />
          Reset to defaults
        </Button>
      </div>
    </div>
  );
}
