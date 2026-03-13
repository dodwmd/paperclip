import { useState } from "react";
import { cn } from "../lib/utils";
import { issueStatusIcon, issueStatusIconDefault } from "../lib/status-colors";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TransitionRule, ColumnDefinition } from "@paperclipai/shared";

const allStatuses = ["backlog", "todo", "ready", "in_progress", "in_review", "qa", "deploy", "done", "cancelled", "blocked"];

function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface StatusIconProps {
  status: string;
  onChange?: (status: string) => void;
  className?: string;
  showLabel?: boolean;
  /** Current issue status — enables policy-aware display when provided with rules */
  currentStatus?: string;
  /** Transition rules for computing allowed transitions from currentStatus */
  rules?: TransitionRule[];
  /** Column definitions for display order and labels */
  columns?: ColumnDefinition[];
}

export function StatusIcon({ status, onChange, className, showLabel, currentStatus, rules, columns }: StatusIconProps) {
  const [open, setOpen] = useState(false);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const colorClass = issueStatusIcon[status] ?? issueStatusIconDefault;
  const isDone = status === "done";

  // Statuses reachable from currentStatus via a defined rule (board can always
  // override, but we grey out non-standard transitions to guide the user).
  const allowedTargets = (rules && currentStatus)
    ? new Set(rules.filter((r) => r.from === currentStatus).map((r) => r.to))
    : null;

  // Display order: use column definitions if provided, else hardcoded defaults
  const displayStatuses = columns ? columns.map((c) => c.status) : allStatuses;

  const labelFor = (s: string) => {
    const col = columns?.find((c) => c.status === s);
    return col?.label ?? statusLabel(s);
  };

  const handleSelect = (s: string) => {
    if (!onChange) return;
    if (s === status) { setOpen(false); return; }
    // Non-standard transition: require board override confirmation
    if (allowedTargets !== null && !allowedTargets.has(s)) {
      setOpen(false);
      setPendingStatus(s);
      return;
    }
    onChange(s);
    setOpen(false);
  };

  const circle = (
    <span
      className={cn(
        "relative inline-flex h-4 w-4 rounded-full border-2 shrink-0",
        colorClass,
        onChange && !showLabel && "cursor-pointer",
        className
      )}
    >
      {isDone && (
        <span className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-current" />
      )}
    </span>
  );

  if (!onChange) {
    return showLabel
      ? <span className="inline-flex items-center gap-1.5">{circle}<span className="text-sm">{statusLabel(status)}</span></span>
      : circle;
  }

  const trigger = showLabel ? (
    <button className="inline-flex items-center gap-1.5 cursor-pointer hover:bg-accent/50 rounded px-1 -mx-1 py-0.5 transition-colors">
      {circle}
      <span className="text-sm">{statusLabel(status)}</span>
    </button>
  ) : circle;

  const pendingLabel = pendingStatus ? labelFor(pendingStatus) : "";
  const fromLabel = currentStatus ? statusLabel(currentStatus) : statusLabel(status);

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent className={cn("p-1", allowedTargets ? "w-48" : "w-40")} align="start">
          {displayStatuses.map((s) => {
            const isDisallowed = allowedTargets !== null && s !== status && !allowedTargets.has(s);
            return (
              <Button
                key={s}
                variant="ghost"
                size="sm"
                className={cn(
                  "w-full justify-start gap-2 text-xs",
                  s === status && "bg-accent",
                  isDisallowed && "opacity-40"
                )}
                onClick={() => handleSelect(s)}
              >
                <StatusIcon status={s} />
                <span className="flex-1 text-left">{labelFor(s)}</span>
                {isDisallowed && (
                  <span className="text-[10px] text-muted-foreground/60 shrink-0">override</span>
                )}
              </Button>
            );
          })}
        </PopoverContent>
      </Popover>

      {/* Override confirmation dialog — shown when board picks a non-standard transition */}
      <Dialog open={pendingStatus !== null} onOpenChange={(open) => { if (!open) setPendingStatus(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Override workflow?</DialogTitle>
            <DialogDescription>
              Moving from <strong>{fromLabel}</strong> to{" "}
              <strong>{pendingLabel}</strong> is outside the normal workflow for this stage.
              As a board operator you can force this transition.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingStatus(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingStatus) onChange(pendingStatus);
                setPendingStatus(null);
              }}
            >
              Force transition
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
