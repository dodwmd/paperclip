/**
 * Integration tests for Kanban workflow enforcement in the issues route.
 *
 * Uses vi.mock to stub the services layer (Option A from QA5 — consistent
 * with existing test patterns in this codebase). No real DB required.
 */
import express, { type Request } from "express";
import request from "supertest";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { errorHandler } from "../middleware/error-handler.js";

// Use vi.hoisted() to create stable mock references that are available
// when the hoisted vi.mock factory runs.
const {
  mockIssueSvc,
  mockAgentSvc,
  mockCompanySvc,
  mockLogActivity,
  mockWakeup,
} = vi.hoisted(() => {
  const mockIssueSvc = {
    getById: vi.fn(),
    getByIdentifier: vi.fn(),
    update: vi.fn(),
    countByStatus: vi.fn(),
    countByStatusAndAssignee: vi.fn(),
    addComment: vi.fn(),
    assertCheckoutOwner: vi.fn(),
    checkout: vi.fn(),
    release: vi.fn(),
    listComments: vi.fn(),
    getComment: vi.fn(),
    listAttachments: vi.fn(),
    listLabels: vi.fn(),
    getLabelById: vi.fn(),
    deleteLabel: vi.fn(),
    createLabel: vi.fn(),
    findMentionedAgents: vi.fn(),
    findMentionedProjectIds: vi.fn(),
    getAncestors: vi.fn(),
    getDependencies: vi.fn(),
    autoUnblockDependents: vi.fn(),
    addBlocker: vi.fn(),
    removeBlocker: vi.fn(),
  };
  const mockAgentSvc = { getById: vi.fn(), update: vi.fn(), list: vi.fn().mockResolvedValue([]) };
  // Return null kanbanConfig so tests use system defaults (backward-compat)
  const mockCompanySvc = { getById: vi.fn().mockResolvedValue({ kanbanConfig: null }) };
  const mockLogActivity = vi.fn();
  const mockWakeup = vi.fn();
  return { mockIssueSvc, mockAgentSvc, mockCompanySvc, mockLogActivity, mockWakeup };
});

vi.mock("../services/index.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    issueService: () => mockIssueSvc,
    agentService: () => mockAgentSvc,
    companyService: () => mockCompanySvc,
    projectService: () => ({
      getById: vi.fn(),
      listByIds: vi.fn().mockResolvedValue([]),
    }),
    goalService: () => ({ getById: vi.fn() }),
    heartbeatService: () => ({
      wakeup: mockWakeup,
      getRun: vi.fn(),
      getActiveRunForAgent: vi.fn(),
      cancelRun: vi.fn(),
    }),
    accessService: () => ({
      canUser: vi.fn().mockResolvedValue(true),
      hasPermission: vi.fn().mockResolvedValue(true),
    }),
    issueApprovalService: () => ({
      listApprovalsForIssue: vi.fn().mockResolvedValue([]),
      link: vi.fn(),
      unlink: vi.fn(),
    }),
    approvalService: () => ({
      listForAgent: vi.fn().mockResolvedValue([]),
    }),
    secretService: () => ({
      normalizeAdapterConfigForPersistence: vi.fn().mockResolvedValue({}),
      resolveSecrets: vi.fn().mockResolvedValue({}),
    }),
    logActivity: mockLogActivity,
    DEFAULT_TRANSITION_RULES: actual.DEFAULT_TRANSITION_RULES,
    WIP_LIMITS: actual.WIP_LIMITS,
    checkTransitionPolicy: actual.checkTransitionPolicy,
    checkWipPolicy: actual.checkWipPolicy,
    resolveKanbanConfig: actual.resolveKanbanConfig,
  };
});

import { issueRoutes } from "../routes/issues.js";
import { agentRoutes } from "../routes/agents.js";
import type { StorageService } from "../storage/types.js";

// ── Data fixtures ──────────────────────────────────────────────────────────

// Use proper UUIDs for IDs that pass through agent-route normalizeAgentReference
// and issue schema UUID validation (e.g. checkoutIssueSchema.agentId).
const AGENT_UUID = "00000000-0000-4000-8000-000000000001";
const AGENT_UUID_2 = "00000000-0000-4000-8000-000000000002";

const baseIssue = {
  id: "issue-1",
  companyId: "company-1",
  status: "in_progress",
  title: "Test issue",
  description: null,
  priority: "medium",
  assigneeAgentId: AGENT_UUID,
  assigneeUserId: null,
  checkoutRunId: "run-1",
  executionRunId: "run-1",
  executionLockedAt: null,
  executionAgentNameKey: null,
  createdByAgentId: null,
  createdByUserId: null,
  projectId: null,
  goalId: null,
  parentId: null,
  issueNumber: 1,
  identifier: "TEST-1",
  requestDepth: 0,
  billingCode: null,
  assigneeAdapterOverrides: null,
  prUrl: null as string | null,
  startedAt: new Date(),
  completedAt: null,
  cancelledAt: null,
  hiddenAt: null,
  labelIds: [],
  labels: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const baseAgent = {
  id: AGENT_UUID,
  companyId: "company-1",
  name: "Test Agent",
  role: "engineer",
  status: "active",
  permissions: null,
  adapterType: null,
  adapterConfig: {},
};

// ── App factory ────────────────────────────────────────────────────────────

const mockStorage = {
  putFile: vi.fn(),
  deleteObject: vi.fn(),
  getSignedUrl: vi.fn(),
  getObject: vi.fn(),
} as unknown as StorageService;

function createApp(actorOverride?: Partial<Request["actor"]>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const base = {
      type: "agent" as const,
      agentId: AGENT_UUID,
      companyId: "company-1",
      source: "agent_key" as const,
      runId: "run-1",
    };
    req.actor = { ...base, ...actorOverride } as Request["actor"];
    next();
  });
  app.use("/api", issueRoutes({} as any, mockStorage));
  app.use(errorHandler);
  return app;
}

function createAgentApp(actorOverride?: Partial<Request["actor"]>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const base = {
      type: "agent" as const,
      agentId: AGENT_UUID,
      companyId: "company-1",
      source: "agent_key" as const,
      runId: "run-1",
    };
    req.actor = { ...base, ...actorOverride } as Request["actor"];
    next();
  });
  app.use("/api", agentRoutes({} as any));
  app.use(errorHandler);
  return app;
}

// ── Test Setup ─────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  mockIssueSvc.getById.mockResolvedValue({ ...baseIssue });
  mockIssueSvc.getByIdentifier.mockResolvedValue(null);
  mockIssueSvc.update.mockResolvedValue({ ...baseIssue });
  mockIssueSvc.countByStatus.mockResolvedValue(0);
  mockIssueSvc.countByStatusAndAssignee.mockResolvedValue(0);
  mockIssueSvc.assertCheckoutOwner.mockResolvedValue({});
  mockIssueSvc.checkout.mockResolvedValue({ ...baseIssue });
  mockIssueSvc.addComment.mockResolvedValue({ id: "comment-1", body: "test", issueId: "issue-1" });
  mockIssueSvc.findMentionedAgents.mockResolvedValue([]);
  mockIssueSvc.findMentionedProjectIds.mockResolvedValue([]);
  mockIssueSvc.getAncestors.mockResolvedValue([]);
  mockIssueSvc.getDependencies.mockResolvedValue({ blockedBy: [], blocks: [] });
  mockIssueSvc.autoUnblockDependents.mockResolvedValue([]);
  mockIssueSvc.listAttachments.mockResolvedValue([]);
  mockIssueSvc.listComments.mockResolvedValue([]);
  mockAgentSvc.getById.mockResolvedValue({ ...baseAgent });
  mockAgentSvc.update.mockResolvedValue({ ...baseAgent });
  mockAgentSvc.list.mockResolvedValue([]);
  mockCompanySvc.getById.mockResolvedValue({ kanbanConfig: null });
  mockLogActivity.mockResolvedValue(undefined);
  mockWakeup.mockResolvedValue(undefined);
  delete process.env.KANBAN_ENFORCEMENT_ENABLED;
});

// ── PATCH /issues/:id — transition enforcement ─────────────────────────────

describe("PATCH /issues/:id — Kanban workflow enforcement", () => {
  afterEach(() => {
    // Safety net: ensure KANBAN_ENFORCEMENT_ENABLED is always cleaned up even if
    // a test throws before its inline cleanup runs.
    delete process.env.KANBAN_ENFORCEMENT_ENABLED;
  });
  it("engineer without prUrl to in_review → 422", async () => {
    mockIssueSvc.getById.mockResolvedValue({ ...baseIssue, status: "in_progress", prUrl: null });

    const app = createApp();
    const res = await request(app)
      .patch("/api/issues/issue-1")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ status: "in_review" });

    expect(res.status).toBe(422);
    expect(res.body.error).toContain("PR URL");
    expect(res.body.details).toMatchObject({ code: "missing_field", from: "in_progress", to: "in_review" });
  });

  it("engineer with prUrl to in_review → 200", async () => {
    const prUrl = "https://github.com/org/repo/pull/1";
    mockIssueSvc.getById.mockResolvedValue({ ...baseIssue, status: "in_progress", prUrl });
    mockIssueSvc.update.mockResolvedValue({ ...baseIssue, status: "in_review", prUrl });

    const app = createApp();
    const res = await request(app)
      .patch("/api/issues/issue-1")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ status: "in_review" });

    expect(res.status).toBe(200);
  });

  it("engineer to deploy (not defined transition) → 422", async () => {
    mockIssueSvc.getById.mockResolvedValue({ ...baseIssue, status: "in_progress" });

    const app = createApp();
    const res = await request(app)
      .patch("/api/issues/issue-1")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ status: "deploy" });

    expect(res.status).toBe(422);
    expect(res.body.details).toMatchObject({ code: "forbidden_role" });
  });

  it("engineer to in_review when WIP limit exceeded → 409", async () => {
    const prUrl = "https://github.com/org/repo/pull/1";
    mockIssueSvc.getById.mockResolvedValue({ ...baseIssue, status: "in_progress", prUrl });
    mockIssueSvc.countByStatus.mockResolvedValue(4); // globalLimit for in_review is 4

    const app = createApp();
    const res = await request(app)
      .patch("/api/issues/issue-1")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ status: "in_review" });

    expect(res.status).toBe(409);
    expect(res.body.details).toMatchObject({ code: "wip_exceeded" });
  });

  it("ready → in_progress when assignee has 2 items → 409", async () => {
    mockIssueSvc.getById.mockResolvedValue({ ...baseIssue, status: "ready" });
    mockIssueSvc.countByStatusAndAssignee.mockResolvedValue(2); // perAssigneeLimit for in_progress is 2

    const app = createApp();
    const res = await request(app)
      .patch("/api/issues/issue-1")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ status: "in_progress" });

    expect(res.status).toBe(409);
    expect(res.body.details).toMatchObject({ code: "wip_exceeded" });
  });

  it("local_implicit board bypasses enforcement → 200", async () => {
    mockIssueSvc.getById.mockResolvedValue({ ...baseIssue, status: "ready", prUrl: null });
    mockIssueSvc.update.mockResolvedValue({ ...baseIssue, status: "in_progress" });

    const app = createApp({ type: "board", userId: "board-user", source: "local_implicit" });
    const res = await request(app)
      .patch("/api/issues/issue-1")
      .set("Origin", "http://localhost:3100")
      .send({ status: "in_progress" });

    expect(res.status).toBe(200);
  });

  it("KANBAN_ENFORCEMENT_ENABLED=false bypasses enforcement → 200", async () => {
    process.env.KANBAN_ENFORCEMENT_ENABLED = "false";
    mockIssueSvc.getById.mockResolvedValue({ ...baseIssue, status: "backlog", prUrl: null });
    mockIssueSvc.update.mockResolvedValue({ ...baseIssue, status: "done" });

    const app = createApp();
    const res = await request(app)
      .patch("/api/issues/issue-1")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ status: "done" });

    expect(res.status).toBe(200);
    delete process.env.KANBAN_ENFORCEMENT_ENABLED;
  });

  it("wrong role (qa agent) for backlog → todo → 422", async () => {
    mockIssueSvc.getById.mockResolvedValue({ ...baseIssue, status: "backlog" });
    mockAgentSvc.getById.mockResolvedValue({ ...baseAgent, role: "qa" });

    const app = createApp();
    const res = await request(app)
      .patch("/api/issues/issue-1")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ status: "todo" });

    expect(res.status).toBe(422);
    expect(res.body.details?.code).toBe("forbidden_role");
  });

  it("transition_denied is logged before error is thrown", async () => {
    mockIssueSvc.getById.mockResolvedValue({ ...baseIssue, status: "backlog" });
    mockAgentSvc.getById.mockResolvedValue({ ...baseAgent, role: "qa" });

    const app = createApp();
    await request(app)
      .patch("/api/issues/issue-1")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ status: "todo" });

    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.transition_denied",
        entityId: "issue-1",
        details: expect.objectContaining({
          from: "backlog",
          to: "todo",
          reason: "forbidden_role",
        }),
      }),
    );
  });

  it("successful transition does NOT produce a denial log entry", async () => {
    mockIssueSvc.getById.mockResolvedValue({ ...baseIssue, status: "ready" });
    mockIssueSvc.update.mockResolvedValue({ ...baseIssue, status: "in_progress" });

    const app = createApp();
    const res = await request(app)
      .patch("/api/issues/issue-1")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ status: "in_progress" });

    expect(res.status).toBe(200);
    const deniedCalls = mockLogActivity.mock.calls.filter(
      (call: unknown[]) => (call[1] as { action?: string })?.action === "issue.transition_denied",
    );
    expect(deniedCalls).toHaveLength(0);
  });
});

// ── GET /issues/:id/workflow ───────────────────────────────────────────────

describe("GET /issues/:id/workflow", () => {
  it("returns transitions for engineer actor on in_progress issue", async () => {
    mockIssueSvc.getById.mockResolvedValue({ ...baseIssue, status: "in_progress", prUrl: null });

    const app = createApp();
    const res = await request(app).get("/api/issues/issue-1/workflow");

    expect(res.status).toBe(200);
    expect(res.body.current).toBe("in_progress");
    expect(Array.isArray(res.body.transitions)).toBe(true);
    // Engineer with no prUrl: in_review should be denied (missing_field)
    const toInReview = res.body.transitions.find((t: { to: string }) => t.to === "in_review");
    expect(toInReview).toBeDefined();
    expect(toInReview.allowed).toBe(false);
    expect(toInReview.reason).toBe("missing_field");
    // Engineer can move to blocked
    const toBlocked = res.body.transitions.find((t: { to: string }) => t.to === "blocked");
    expect(toBlocked?.allowed).toBe(true);
  });

  it("returns 404 for missing issue", async () => {
    mockIssueSvc.getById.mockResolvedValue(null);

    const app = createApp();
    const res = await request(app).get("/api/issues/nonexistent-id/workflow");
    expect(res.status).toBe(404);
  });

  it("board actor sees all defined transitions as allowed (role-wise)", async () => {
    mockIssueSvc.getById.mockResolvedValue({ ...baseIssue, status: "backlog", prUrl: null });

    const app = createApp({ type: "board", userId: "board-user", source: "session", isInstanceAdmin: true });
    const res = await request(app)
      .get("/api/issues/issue-1/workflow")
      .set("Origin", "http://localhost:3100");

    expect(res.status).toBe(200);
    const toTodo = res.body.transitions.find((t: { to: string }) => t.to === "todo");
    expect(toTodo?.allowed).toBe(true);
    const toCancelled = res.body.transitions.find((t: { to: string }) => t.to === "cancelled");
    expect(toCancelled?.allowed).toBe(true);
  });

  it("does not include wipLimits in response", async () => {
    mockIssueSvc.getById.mockResolvedValue({ ...baseIssue, status: "in_progress" });

    const app = createApp();
    const res = await request(app).get("/api/issues/issue-1/workflow");
    expect(res.status).toBe(200);
    expect(res.body.wipLimits).toBeUndefined();
  });

  it("includes prUrl in response", async () => {
    const prUrl = "https://github.com/org/repo/pull/42";
    mockIssueSvc.getById.mockResolvedValue({ ...baseIssue, status: "in_progress", prUrl });

    const app = createApp();
    const res = await request(app).get("/api/issues/issue-1/workflow");
    expect(res.status).toBe(200);
    expect(res.body.prUrl).toBe(prUrl);
  });
});

// ── Comment reopen enforcement ─────────────────────────────────────────────

describe("POST /issues/:id/comments — reopen enforcement", () => {
  it("engineer cannot reopen done issue to todo", async () => {
    mockIssueSvc.getById.mockResolvedValue({
      ...baseIssue,
      status: "done",
      checkoutRunId: null,
      executionRunId: null,
    });

    const app = createApp();
    const res = await request(app)
      .post("/api/issues/issue-1/comments")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ body: "Please reopen", reopen: true });

    expect(res.status).toBe(422);
    expect(res.body.details?.code).toBe("forbidden_role");
  });

  it("pm cannot reopen done issue to todo (done tickets are not reopened — raise a new ticket)", async () => {
    mockIssueSvc.getById.mockResolvedValue({
      ...baseIssue,
      status: "done",
      checkoutRunId: null,
      executionRunId: null,
    });
    mockAgentSvc.getById.mockResolvedValue({ ...baseAgent, role: "pm" });

    const app = createApp();
    const res = await request(app)
      .post("/api/issues/issue-1/comments")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ body: "Reopening for revision", reopen: true });

    expect(res.status).toBe(422);
    expect(res.body.details?.code).toBe("forbidden_role");
  });

  it("board can force-reopen done issue to todo (board override bypass)", async () => {
    // Done tickets are not reopened by normal workflow rules, but board actors
    // can bypass undefined transitions as a force override.
    mockIssueSvc.getById.mockResolvedValue({
      ...baseIssue,
      status: "done",
      checkoutRunId: null,
      executionRunId: null,
    });
    mockIssueSvc.update.mockResolvedValue({ ...baseIssue, status: "todo" });

    const app = createApp({ type: "board", userId: "board-user", source: "session", isInstanceAdmin: true });
    const res = await request(app)
      .post("/api/issues/issue-1/comments")
      .set("Origin", "http://localhost:3100")
      .send({ body: "Reopening", reopen: true });

    expect(res.status).toBe(201);
  });

  it("pm can reopen cancelled issue to todo", async () => {
    mockIssueSvc.getById.mockResolvedValue({
      ...baseIssue,
      status: "cancelled",
      checkoutRunId: null,
      executionRunId: null,
    });
    mockAgentSvc.getById.mockResolvedValue({ ...baseAgent, role: "pm" });
    mockIssueSvc.update.mockResolvedValue({ ...baseIssue, status: "todo" });

    const app = createApp();
    const res = await request(app)
      .post("/api/issues/issue-1/comments")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ body: "Restoring cancelled ticket", reopen: true });

    expect(res.status).toBe(201);
  });
});

// ── resolveActorRole failure modes ─────────────────────────────────────────

describe("resolveActorRole — failure modes", () => {
  it("agent not found → treated as general role → denied on restricted transitions", async () => {
    mockIssueSvc.getById.mockResolvedValue({ ...baseIssue, status: "backlog" });
    mockAgentSvc.getById.mockResolvedValue(null); // Agent not found → null role → general → denied

    const app = createApp();
    const res = await request(app)
      .patch("/api/issues/issue-1")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ status: "todo" });

    expect(res.status).toBe(422);
    expect(res.body.details?.code).toBe("forbidden_role");
  });
});

// ── WIP log before throw ───────────────────────────────────────────────────

describe("WIP enforcement — activity log", () => {
  it("wip_exceeded log entry is written before 409 is thrown", async () => {
    mockIssueSvc.getById.mockResolvedValue({
      ...baseIssue,
      status: "in_progress",
      prUrl: "https://github.com/org/repo/pull/1",
    });
    mockIssueSvc.countByStatus.mockResolvedValue(4); // in_review globalLimit = 4

    const app = createApp();
    const res = await request(app)
      .patch("/api/issues/issue-1")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ status: "in_review" });

    expect(res.status).toBe(409);
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "issue.wip_exceeded" }),
    );
  });
});

// ── TEST-1: PATCH /agents/:id — agent role-change block ────────────────────

describe("PATCH /agents/:id — agent role-change block", () => {
  it("agent actor cannot change own role → 403", async () => {
    // mockAgentSvc.getById returns baseAgent (same agent as actor, self-update)
    const app = createAgentApp();
    const res = await request(app)
      .patch(`/api/agents/${AGENT_UUID}`)
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ role: "ceo" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/role/i);
  });

  it("agent actor cannot change another agent's role → 403", async () => {
    // Actor is AGENT_UUID (engineer), target is same agent but as CEO.
    // Both getById calls should return the agent so that assertCanUpdateAgent passes,
    // then the role-change check fires.
    mockAgentSvc.getById
      .mockResolvedValueOnce({ ...baseAgent, id: AGENT_UUID, role: "ceo" }) // target lookup
      .mockResolvedValueOnce({ ...baseAgent, id: AGENT_UUID, role: "ceo" }); // actor lookup in assertCanUpdateAgent

    const app = createAgentApp();
    const res = await request(app)
      .patch(`/api/agents/${AGENT_UUID}`)
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ role: "devops" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/role/i);
  });

  it("board actor can change agent role → 200", async () => {
    mockAgentSvc.update.mockResolvedValue({ ...baseAgent, role: "devops" });

    const app = createAgentApp({
      type: "board",
      userId: "board-user",
      source: "session",
      isInstanceAdmin: true,
    });
    const res = await request(app)
      .patch(`/api/agents/${AGENT_UUID}`)
      .set("Origin", "http://localhost:3100")
      .send({ role: "devops" });

    expect(res.status).toBe(200);
  });
});

// ── TEST-2: Review-rejection wakeup ───────────────────────────────────────

describe("PATCH /issues/:id — review-rejection wakeup", () => {
  it("in_review → in_progress with same assignee triggers wakeup with reason issue_review_rejected", async () => {
    mockIssueSvc.getById.mockResolvedValue({
      ...baseIssue,
      status: "in_review",
      assigneeAgentId: AGENT_UUID,
      prUrl: "https://github.com/org/repo/pull/1",
    });
    mockIssueSvc.update.mockResolvedValue({ ...baseIssue, status: "in_progress" });
    mockAgentSvc.getById.mockResolvedValue({ ...baseAgent, role: "engineer" });

    const app = createApp();
    const res = await request(app)
      .patch("/api/issues/issue-1")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ status: "in_progress" });

    expect(res.status).toBe(200);
    expect(mockWakeup).toHaveBeenCalledWith(
      AGENT_UUID,
      expect.objectContaining({ reason: "issue_review_rejected" }),
    );
  });

  it("qa → in_progress with same assignee triggers wakeup with reason issue_review_rejected", async () => {
    mockIssueSvc.getById.mockResolvedValue({
      ...baseIssue,
      status: "qa",
      assigneeAgentId: AGENT_UUID,
    });
    mockIssueSvc.update.mockResolvedValue({ ...baseIssue, status: "in_progress" });
    mockAgentSvc.getById.mockResolvedValue({ ...baseAgent, role: "qa" });

    const app = createApp();
    const res = await request(app)
      .patch("/api/issues/issue-1")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ status: "in_progress" });

    expect(res.status).toBe(200);
    expect(mockWakeup).toHaveBeenCalledWith(
      AGENT_UUID,
      expect.objectContaining({ reason: "issue_review_rejected" }),
    );
  });

  it("in_review → in_progress with assignee changed does NOT trigger review-rejection wakeup", async () => {
    mockIssueSvc.getById.mockResolvedValue({
      ...baseIssue,
      status: "in_review",
      assigneeAgentId: AGENT_UUID,
      prUrl: "https://github.com/org/repo/pull/1",
    });
    mockIssueSvc.update.mockResolvedValue({ ...baseIssue, status: "in_progress", assigneeAgentId: AGENT_UUID_2 });
    mockAgentSvc.getById.mockResolvedValue({ ...baseAgent, role: "engineer" });

    const app = createApp();
    const res = await request(app)
      .patch("/api/issues/issue-1")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ status: "in_progress", assigneeAgentId: AGENT_UUID_2 });

    expect(res.status).toBe(200);
    // Wakeup may be called for assignment change but NOT with issue_review_rejected
    const rejectedWakeupCalls = mockWakeup.mock.calls.filter(
      (call: unknown[]) =>
        (call[1] as { reason?: string })?.reason === "issue_review_rejected",
    );
    expect(rejectedWakeupCalls).toHaveLength(0);
  });
});

// ── TEST-4: Reopen from cancelled status ──────────────────────────────────

describe("POST /issues/:id/comments — reopen from cancelled", () => {
  it("engineer cannot reopen cancelled issue → 422", async () => {
    mockIssueSvc.getById.mockResolvedValue({
      ...baseIssue,
      status: "cancelled",
      checkoutRunId: null,
      executionRunId: null,
    });
    // engineer role (default baseAgent)
    const app = createApp();
    const res = await request(app)
      .post("/api/issues/issue-1/comments")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ body: "Please reopen", reopen: true });

    expect(res.status).toBe(422);
    expect(res.body.details?.code).toBe("forbidden_role");
  });

  it("pm can reopen cancelled issue → 201", async () => {
    mockIssueSvc.getById.mockResolvedValue({
      ...baseIssue,
      status: "cancelled",
      checkoutRunId: null,
      executionRunId: null,
    });
    mockAgentSvc.getById.mockResolvedValue({ ...baseAgent, role: "pm" });
    mockIssueSvc.update.mockResolvedValue({ ...baseIssue, status: "todo" });

    const app = createApp();
    const res = await request(app)
      .post("/api/issues/issue-1/comments")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ body: "Reopening for revision", reopen: true });

    expect(res.status).toBe(201);
  });
});

// ── TEST-5: Checkout capability block for non-engineer ────────────────────

describe("POST /issues/:id/checkout — role capability check", () => {
  it("qa-role agent cannot checkout → 422 forbidden_role", async () => {
    mockIssueSvc.getById.mockResolvedValue({ ...baseIssue, status: "ready" });
    mockAgentSvc.getById.mockResolvedValue({ ...baseAgent, role: "qa" });

    const app = createApp();
    const res = await request(app)
      .post("/api/issues/issue-1/checkout")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ agentId: AGENT_UUID, expectedStatuses: ["ready"] });

    expect(res.status).toBe(422);
    expect(res.body.details?.code).toBe("forbidden_role");
  });

  it("engineer-role agent can checkout → 200", async () => {
    mockIssueSvc.getById.mockResolvedValue({ ...baseIssue, status: "ready" });
    mockAgentSvc.getById.mockResolvedValue({ ...baseAgent, role: "engineer" });
    mockIssueSvc.checkout.mockResolvedValue({ ...baseIssue, status: "in_progress" });

    const app = createApp();
    const res = await request(app)
      .post("/api/issues/issue-1/checkout")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ agentId: AGENT_UUID, expectedStatuses: ["ready"] });

    expect(res.status).toBe(200);
  });

  it("general-role agent can checkout (general is a checkout-capable role)", async () => {
    mockIssueSvc.getById.mockResolvedValue({ ...baseIssue, status: "ready" });
    mockAgentSvc.getById.mockResolvedValue({ ...baseAgent, role: "general" });

    const app = createApp();
    const res = await request(app)
      .post("/api/issues/issue-1/checkout")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ agentId: AGENT_UUID, expectedStatuses: ["ready"] });

    expect(res.status).toBe(200);
  });
});
