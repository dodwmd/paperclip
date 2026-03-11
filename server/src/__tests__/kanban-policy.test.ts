import { describe, expect, it } from "vitest";
import {
  checkTransitionPolicy,
  checkWipPolicy,
  DEFAULT_TRANSITION_RULES,
  WIP_LIMITS,
  type TransitionActor,
} from "@paperclipai/shared";

// ── Helpers ────────────────────────────────────────────────────────────────

const board: TransitionActor = { kind: "board", role: null };
const actor = (role: string | null): TransitionActor => ({ kind: "agent", role });

// ── checkTransitionPolicy ─────────────────────────────────────────────────

describe("checkTransitionPolicy – allowed transitions", () => {
  it("cto can move backlog → todo", () => {
    const result = checkTransitionPolicy("backlog", "todo", actor("cto"), {});
    expect(result.allowed).toBe(true);
  });

  it("board can move backlog → todo", () => {
    const result = checkTransitionPolicy("backlog", "todo", board, {});
    expect(result.allowed).toBe(true);
  });

  it("engineer can move ready → in_progress", () => {
    const result = checkTransitionPolicy("ready", "in_progress", actor("engineer"), {});
    expect(result.allowed).toBe(true);
  });

  it("engineer with prUrl can move in_progress → in_review", () => {
    const result = checkTransitionPolicy("in_progress", "in_review", actor("engineer"), {
      prUrl: "https://github.com/org/repo/pull/1",
    });
    expect(result.allowed).toBe(true);
  });

  it("qa can move qa → deploy", () => {
    const result = checkTransitionPolicy("qa", "deploy", actor("qa"), {});
    expect(result.allowed).toBe(true);
  });

  it("devops can move deploy → done", () => {
    const result = checkTransitionPolicy("deploy", "done", actor("devops"), {});
    expect(result.allowed).toBe(true);
  });

  it("pm can move cancelled → todo", () => {
    const result = checkTransitionPolicy("cancelled", "todo", actor("pm"), {});
    expect(result.allowed).toBe(true);
  });

  it("cto can move in_review → qa", () => {
    const result = checkTransitionPolicy("in_review", "qa", actor("cto"), {});
    expect(result.allowed).toBe(true);
  });

  it("cto can move blocked → in_progress", () => {
    const result = checkTransitionPolicy("blocked", "in_progress", actor("cto"), {});
    expect(result.allowed).toBe(true);
  });

  it("engineer can move blocked → in_progress", () => {
    const result = checkTransitionPolicy("blocked", "in_progress", actor("engineer"), {});
    expect(result.allowed).toBe(true);
  });

  it("devops can move deploy → qa (rollback)", () => {
    const result = checkTransitionPolicy("deploy", "qa", actor("devops"), {});
    expect(result.allowed).toBe(true);
  });
});

describe("checkTransitionPolicy – board bypasses ALL role checks", () => {
  it("board can move any defined transition regardless of role", () => {
    // Board can move ready → cancelled (pm-only)
    expect(checkTransitionPolicy("ready", "cancelled", board, {}).allowed).toBe(true);
    // Board can move backlog → todo (cto-only)
    expect(checkTransitionPolicy("backlog", "todo", board, {}).allowed).toBe(true);
    // Board can move blocked → in_progress
    expect(checkTransitionPolicy("blocked", "in_progress", board, {}).allowed).toBe(true);
  });

  it("board can move strict quality gate: qa → deploy", () => {
    const result = checkTransitionPolicy("qa", "deploy", board, {});
    expect(result.allowed).toBe(true);
  });

  it("board can move strict quality gate: deploy → done", () => {
    const result = checkTransitionPolicy("deploy", "done", board, {});
    expect(result.allowed).toBe(true);
  });

  it("board is still denied missing required field (prUrl)", () => {
    const result = checkTransitionPolicy("in_progress", "in_review", board, { prUrl: null });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("missing_field");
  });

  it("board with prUrl can move in_progress → in_review", () => {
    const result = checkTransitionPolicy("in_progress", "in_review", board, {
      prUrl: "https://github.com/org/repo/pull/42",
    });
    expect(result.allowed).toBe(true);
  });
});

describe("checkTransitionPolicy – denied: wrong role", () => {
  it("pm cannot move backlog → todo (triage is Tech Lead only)", () => {
    const result = checkTransitionPolicy("backlog", "todo", actor("pm"), {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("forbidden_role");
  });

  it("qa agent cannot move backlog → todo", () => {
    const result = checkTransitionPolicy("backlog", "todo", actor("qa"), {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("forbidden_role");
  });

  it("engineer cannot move qa → deploy", () => {
    const result = checkTransitionPolicy("qa", "deploy", actor("engineer"), {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("forbidden_role");
  });

  it("devops cannot move in_progress → in_review", () => {
    const result = checkTransitionPolicy("in_progress", "in_review", actor("devops"), {
      prUrl: "https://github.com/org/repo/pull/1",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("forbidden_role");
  });

  it("pm cannot move in_progress → in_review", () => {
    const result = checkTransitionPolicy("in_progress", "in_review", actor("pm"), {
      prUrl: "https://github.com/org/repo/pull/1",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("forbidden_role");
  });

  it("cto cannot move deploy → done (devops-only)", () => {
    const result = checkTransitionPolicy("deploy", "done", actor("cto"), {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("forbidden_role");
  });
});

describe("checkTransitionPolicy – denied: general role", () => {
  it("general role is blocked from backlog → todo", () => {
    const result = checkTransitionPolicy("backlog", "todo", actor("general"), {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("forbidden_role");
    expect(result.detail).toContain("general");
  });

  it("general role is blocked from ready → in_progress", () => {
    const result = checkTransitionPolicy("ready", "in_progress", actor("general"), {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("forbidden_role");
  });

  it("null role (agent not found) is treated as general and denied", () => {
    const result = checkTransitionPolicy("backlog", "todo", actor(null), {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("forbidden_role");
  });
});

describe("checkTransitionPolicy – denied: missing required field", () => {
  it("engineer without prUrl cannot move in_progress → in_review", () => {
    const result = checkTransitionPolicy("in_progress", "in_review", actor("engineer"), {
      prUrl: null,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("missing_field");
    expect(result.detail).toContain("PR URL");
  });

  it("engineer with empty string prUrl is denied (treated as missing)", () => {
    const result = checkTransitionPolicy("in_progress", "in_review", actor("engineer"), {
      prUrl: "",
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("missing_field");
  });

  it("board without prUrl is denied by missing_field check", () => {
    const result = checkTransitionPolicy("in_progress", "in_review", board, { prUrl: null });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("missing_field");
  });
});

describe("checkTransitionPolicy – denied: undefined transition", () => {
  it("done → todo is not defined (raise a new ticket instead)", () => {
    const result = checkTransitionPolicy("done", "todo", actor("pm"), {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("forbidden_role");
    expect(result.detail).toContain("not defined");
  });

  it("ready → done directly is not defined", () => {
    const result = checkTransitionPolicy("ready", "done", board, {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("forbidden_role");
    expect(result.detail).toContain("not defined");
  });

  it("backlog → deploy directly is not defined", () => {
    const result = checkTransitionPolicy("backlog", "deploy", actor("devops"), {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("forbidden_role");
  });

  it("in_progress → done directly is not defined", () => {
    const result = checkTransitionPolicy("in_progress", "done", actor("engineer"), {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("forbidden_role");
  });
});

describe("checkTransitionPolicy – no-op (from === to)", () => {
  it("from === to is always allowed", () => {
    expect(checkTransitionPolicy("backlog", "backlog", actor("general"), {}).allowed).toBe(true);
    expect(checkTransitionPolicy("in_progress", "in_progress", actor("general"), {}).allowed).toBe(true);
    expect(checkTransitionPolicy("done", "done", actor(null), {}).allowed).toBe(true);
  });

  it("no-op skips prUrl check even when transition would require it", () => {
    // in_progress → in_progress should be allowed even with no prUrl
    const result = checkTransitionPolicy("in_progress", "in_progress", actor("engineer"), {
      prUrl: null,
    });
    expect(result.allowed).toBe(true);
  });
});

describe("checkTransitionPolicy – pm cancellation paths", () => {
  const cancellableFrom = [
    "backlog", "todo", "ready", "in_progress", "in_review", "qa", "deploy", "blocked",
  ] as const;
  for (const from of cancellableFrom) {
    it(`pm can cancel from ${from}`, () => {
      const result = checkTransitionPolicy(from, "cancelled", actor("pm"), {});
      expect(result.allowed).toBe(true);
    });
  }
});

describe("checkTransitionPolicy – devops transitions", () => {
  it("devops: deploy → done", () => {
    expect(checkTransitionPolicy("deploy", "done", actor("devops"), {}).allowed).toBe(true);
  });

  it("devops: deploy → qa (rollback)", () => {
    expect(checkTransitionPolicy("deploy", "qa", actor("devops"), {}).allowed).toBe(true);
  });

  it("devops: cannot move in_progress → in_review", () => {
    const result = checkTransitionPolicy("in_progress", "in_review", actor("devops"), {
      prUrl: "https://github.com/org/repo/pull/1",
    });
    expect(result.allowed).toBe(false);
  });
});

describe("checkTransitionPolicy – cto transitions", () => {
  it("cto: backlog → todo", () => {
    expect(checkTransitionPolicy("backlog", "todo", actor("cto"), {}).allowed).toBe(true);
  });

  it("cto: todo → ready", () => {
    expect(checkTransitionPolicy("todo", "ready", actor("cto"), {}).allowed).toBe(true);
  });

  it("cto: todo → backlog (demote)", () => {
    expect(checkTransitionPolicy("todo", "backlog", actor("cto"), {}).allowed).toBe(true);
  });

  it("cto: ready → todo (demote for re-refinement)", () => {
    expect(checkTransitionPolicy("ready", "todo", actor("cto"), {}).allowed).toBe(true);
  });

  it("cto: blocked → in_progress", () => {
    expect(checkTransitionPolicy("blocked", "in_progress", actor("cto"), {}).allowed).toBe(true);
  });

  it("cto: in_progress → in_review with prUrl", () => {
    const result = checkTransitionPolicy("in_progress", "in_review", actor("cto"), {
      prUrl: "https://github.com/org/repo/pull/1",
    });
    expect(result.allowed).toBe(true);
  });

  it("cto: in_progress → in_review denied without prUrl", () => {
    const result = checkTransitionPolicy("in_progress", "in_review", actor("cto"), { prUrl: null });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("missing_field");
  });

  it("cto: in_progress → blocked", () => {
    expect(checkTransitionPolicy("in_progress", "blocked", actor("cto"), {}).allowed).toBe(true);
  });

  it("cto: cannot deploy → done (devops-only strict gate)", () => {
    const result = checkTransitionPolicy("deploy", "done", actor("cto"), {});
    expect(result.allowed).toBe(false);
  });

  it("pm: cannot move todo → backlog (cto-only)", () => {
    const result = checkTransitionPolicy("todo", "backlog", actor("pm"), {});
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("forbidden_role");
  });
});

describe("checkTransitionPolicy – engineer review paths", () => {
  it("engineer: in_review → qa (pass to QA)", () => {
    expect(checkTransitionPolicy("in_review", "qa", actor("engineer"), {}).allowed).toBe(true);
  });

  it("engineer: in_review → in_progress (send back to self)", () => {
    expect(checkTransitionPolicy("in_review", "in_progress", actor("engineer"), {}).allowed).toBe(true);
  });
});

describe("checkTransitionPolicy – custom rules", () => {
  it("accepts custom rules array", () => {
    const customRules = [
      { from: "todo" as const, to: "done" as const, allowedRoles: ["engineer"] },
    ];
    const result = checkTransitionPolicy("todo", "done", actor("engineer"), {}, customRules);
    expect(result.allowed).toBe(true);
  });
});

// ── checkWipPolicy ────────────────────────────────────────────────────────

describe("checkWipPolicy – global limits", () => {
  it("ready: allows when count is below limit (9 < 10)", () => {
    const result = checkWipPolicy("ready", 9, null, 0);
    expect(result.allowed).toBe(true);
  });

  it("ready: allows when count is exactly at limit boundary (9/10 → adding 1 would be 10 = limit)", () => {
    // The count represents current count BEFORE the new issue is added
    // Our implementation: >= globalLimit means denied, so count=9 < 10 = allowed
    const result = checkWipPolicy("ready", 9, null, 0);
    expect(result.allowed).toBe(true);
  });

  it("ready: denies when count equals limit (10 >= 10)", () => {
    const result = checkWipPolicy("ready", 10, null, 0);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("wip_exceeded");
  });

  it("ready: denies when count exceeds limit (11 > 10)", () => {
    const result = checkWipPolicy("ready", 11, null, 0);
    expect(result.allowed).toBe(false);
  });

  it("in_review: allows at 3 (below 4 limit)", () => {
    expect(checkWipPolicy("in_review", 3, null, 0).allowed).toBe(true);
  });

  it("in_review: denies at 4 (at limit)", () => {
    const result = checkWipPolicy("in_review", 4, null, 0);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("wip_exceeded");
  });

  it("qa: allows at 3 (below 4 limit)", () => {
    expect(checkWipPolicy("qa", 3, null, 0).allowed).toBe(true);
  });

  it("qa: denies at 4 (at limit)", () => {
    const result = checkWipPolicy("qa", 4, null, 0);
    expect(result.allowed).toBe(false);
  });
});

describe("checkWipPolicy – per-assignee limits", () => {
  it("in_progress: allows when assignee has 1 (below limit of 2)", () => {
    const result = checkWipPolicy("in_progress", 5, "agent-1", 1);
    expect(result.allowed).toBe(true);
  });

  it("in_progress: denies when assignee has 2 (at limit)", () => {
    const result = checkWipPolicy("in_progress", 5, "agent-1", 2);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("wip_exceeded");
  });

  it("in_progress: does not apply per-assignee limit when assigneeAgentId is null", () => {
    const result = checkWipPolicy("in_progress", 5, null, 0);
    expect(result.allowed).toBe(true);
  });

  it("in_progress: applies global limit (if set) regardless of assignee", () => {
    // in_progress has no global limit in WIP_LIMITS, only per-assignee
    // So global count shouldn't matter
    const result = checkWipPolicy("in_progress", 100, "agent-1", 1);
    expect(result.allowed).toBe(true);
  });
});

describe("checkWipPolicy – unconfigured columns", () => {
  it("backlog has no WIP limit", () => {
    expect(checkWipPolicy("backlog", 9999, "agent-1", 9999).allowed).toBe(true);
  });

  it("done has no WIP limit", () => {
    expect(checkWipPolicy("done", 9999, null, 0).allowed).toBe(true);
  });

  it("cancelled has no WIP limit", () => {
    expect(checkWipPolicy("cancelled", 9999, null, 0).allowed).toBe(true);
  });

  it("blocked has no WIP limit", () => {
    expect(checkWipPolicy("blocked", 9999, "agent-1", 9999).allowed).toBe(true);
  });
});

describe("checkWipPolicy – custom wipLimits", () => {
  it("accepts custom wipLimits object", () => {
    const customLimits = { todo: { globalLimit: 5 } } as typeof WIP_LIMITS;
    const denied = checkWipPolicy("todo", 5, null, 0, customLimits);
    expect(denied.allowed).toBe(false);

    const allowed = checkWipPolicy("todo", 4, null, 0, customLimits);
    expect(allowed.allowed).toBe(true);
  });
});

// ── DEFAULT_TRANSITION_RULES completeness check ────────────────────────────

describe("DEFAULT_TRANSITION_RULES completeness", () => {
  it("all from/to statuses are valid IssueStatus values", () => {
    const validStatuses = new Set([
      "backlog", "todo", "ready", "in_progress", "in_review",
      "qa", "deploy", "done", "blocked", "cancelled",
    ]);
    for (const rule of DEFAULT_TRANSITION_RULES) {
      expect(validStatuses.has(rule.from)).toBe(true);
      expect(validStatuses.has(rule.to)).toBe(true);
    }
  });

  it("no duplicate from/to pairs", () => {
    const seen = new Set<string>();
    for (const rule of DEFAULT_TRANSITION_RULES) {
      const key = `${rule.from}→${rule.to}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});
