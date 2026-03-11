/**
 * Unit tests for findMentionedAgents role fan-out in issueService.
 *
 * Tests the ROLE_MENTION_MAP aliases (@dev → engineer, @techlead → cto, @qa → qa)
 * and deduplication behaviour.
 */
import { describe, expect, it } from "vitest";
import { issueService } from "../services/issues.js";

// ── DB stub factory ───────────────────────────────────────────────────────

/**
 * Creates a minimal Drizzle-style DB stub whose `select().from().where()`
 * chain resolves to the given agent rows.
 */
function makeDbStub(agentRows: { id: string; name: string; role: string | null }[]) {
  const whereFn = () => Promise.resolve(agentRows);
  const fromFn = () => ({ where: whereFn });
  const selectFn = () => ({ from: fromFn });
  return { select: selectFn } as unknown as Parameters<typeof issueService>[0];
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("findMentionedAgents — role fan-out", () => {
  it("@qa in body → returns all agents with role qa", async () => {
    const db = makeDbStub([
      { id: "a1", name: "Alice", role: "qa" },
      { id: "a2", name: "Bob", role: "engineer" },
      { id: "a3", name: "Carol", role: "qa" },
    ]);
    const svc = issueService(db);
    const result = await svc.findMentionedAgents("company-1", "Hey @qa please review");
    expect(result).toContain("a1");
    expect(result).toContain("a3");
    expect(result).not.toContain("a2");
  });

  it("@dev in body → returns all agents with role engineer", async () => {
    const db = makeDbStub([
      { id: "a1", name: "Alice", role: "engineer" },
      { id: "a2", name: "Bob", role: "qa" },
      { id: "a3", name: "Carol", role: "engineer" },
    ]);
    const svc = issueService(db);
    const result = await svc.findMentionedAgents("company-1", "FYI @dev this needs work");
    expect(result).toContain("a1");
    expect(result).toContain("a3");
    expect(result).not.toContain("a2");
  });

  it("@techlead in body → returns all agents with role cto", async () => {
    const db = makeDbStub([
      { id: "a1", name: "Alice", role: "cto" },
      { id: "a2", name: "Bob", role: "engineer" },
    ]);
    const svc = issueService(db);
    const result = await svc.findMentionedAgents("company-1", "Escalating to @techlead");
    expect(result).toContain("a1");
    expect(result).not.toContain("a2");
  });

  it("agent named 'alice' with role qa + @qa mention → alice appears once (no duplicate)", async () => {
    const db = makeDbStub([
      { id: "a1", name: "alice", role: "qa" },
      { id: "a2", name: "Bob", role: "qa" },
    ]);
    const svc = issueService(db);
    // @alice matches by name AND @qa also matches alice by role — should deduplicate
    const result = await svc.findMentionedAgents("company-1", "@alice @qa please review");
    const aliceCount = result.filter((id) => id === "a1").length;
    expect(aliceCount).toBe(1);
    expect(result).toContain("a2");
  });

  it("no @ tokens returns empty array", async () => {
    const db = makeDbStub([
      { id: "a1", name: "Alice", role: "engineer" },
    ]);
    const svc = issueService(db);
    const result = await svc.findMentionedAgents("company-1", "This comment has no mentions");
    expect(result).toHaveLength(0);
  });

  it("unknown @handle returns empty array", async () => {
    const db = makeDbStub([
      { id: "a1", name: "Alice", role: "engineer" },
    ]);
    const svc = issueService(db);
    const result = await svc.findMentionedAgents("company-1", "@nobody should see this");
    expect(result).toHaveLength(0);
  });

  it("@engineer in body → returns all agents with role engineer", async () => {
    const db = makeDbStub([
      { id: "a1", name: "Alice", role: "engineer" },
      { id: "a2", name: "Bob", role: "pm" },
    ]);
    const svc = issueService(db);
    const result = await svc.findMentionedAgents("company-1", "Ping @engineer for code review");
    expect(result).toContain("a1");
    expect(result).not.toContain("a2");
  });

  it("@productowner alias → resolves to pm role", async () => {
    const db = makeDbStub([
      { id: "a1", name: "Product Owner", role: "pm" },
      { id: "a2", name: "Alice", role: "engineer" },
    ]);
    const svc = issueService(db);
    const result = await svc.findMentionedAgents("company-1", "@productowner please confirm AC");
    expect(result).toContain("a1");
    expect(result).not.toContain("a2");
  });

  it("@po alias → resolves to pm role", async () => {
    const db = makeDbStub([
      { id: "a1", name: "Product Owner", role: "pm" },
      { id: "a2", name: "Alice", role: "cto" },
    ]);
    const svc = issueService(db);
    const result = await svc.findMentionedAgents("company-1", "@po please review");
    expect(result).toContain("a1");
    expect(result).not.toContain("a2");
  });

  it("@developer alias → resolves to engineer role", async () => {
    const db = makeDbStub([
      { id: "a1", name: "Dev Bot", role: "engineer" },
      { id: "a2", name: "QA Bot", role: "qa" },
    ]);
    const svc = issueService(db);
    const result = await svc.findMentionedAgents("company-1", "Assigning to @developer");
    expect(result).toContain("a1");
    expect(result).not.toContain("a2");
  });
});
