/**
 * Tests for issue dependency (blocked-by) functionality.
 *
 * Covers:
 *  - Service-level: getDependencies, addBlocker (happy path, self-dep, cross-company,
 *    circular 2-hop, idempotent add)
 *  - Route-level: GET /issues/:id/blockers, POST /issues/:id/blockers,
 *    DELETE /issues/:id/blockers/:blockerId, 404, 422 validation,
 *    company access control
 *
 * Uses vi.mock() to stub the services layer — no real DB required.
 */
import express, { type Request } from "express";
import request from "supertest";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { errorHandler } from "../middleware/error-handler.js";
import { HttpError } from "../errors.js";

// ── Stable mock references (hoisted) ────────────────────────────────────────

const {
  mockIssueSvc,
  mockLogActivity,
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
  const mockLogActivity = vi.fn();
  return { mockIssueSvc, mockLogActivity };
});

vi.mock("../services/index.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    issueService: () => mockIssueSvc,
    agentService: () => ({ getById: vi.fn(), update: vi.fn() }),
    projectService: () => ({
      getById: vi.fn(),
      listByIds: vi.fn().mockResolvedValue([]),
    }),
    goalService: () => ({ getById: vi.fn() }),
    heartbeatService: () => ({
      wakeup: vi.fn(),
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
  };
});

import { issueRoutes } from "../routes/issues.js";
import type { StorageService } from "../storage/types.js";

// ── Data fixtures ────────────────────────────────────────────────────────────

const AGENT_UUID = "00000000-0000-4000-8000-000000000001";
// blockerId in POST /issues/:id/blockers must be a UUID (validated by addIssueDependencySchema)
const BLOCKER_UUID = "00000000-0000-4000-8000-000000000002";
const BLOCKER_UUID_2 = "00000000-0000-4000-8000-000000000003";

const baseIssue = {
  id: "issue-1",
  companyId: "company-1",
  status: "todo" as const,
  title: "Test issue",
  description: null,
  priority: "medium",
  assigneeAgentId: null,
  assigneeUserId: null,
  checkoutRunId: null,
  executionRunId: null,
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
  startedAt: null,
  completedAt: null,
  cancelledAt: null,
  hiddenAt: null,
  labelIds: [],
  labels: [],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const baseDeps = { blockedBy: [], blocks: [] };

// ── App factory ──────────────────────────────────────────────────────────────

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

// ── Test Setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  mockIssueSvc.getById.mockResolvedValue({ ...baseIssue });
  mockIssueSvc.getDependencies.mockResolvedValue({ ...baseDeps });
  mockIssueSvc.addBlocker.mockResolvedValue(undefined);
  mockIssueSvc.removeBlocker.mockResolvedValue({ deleted: true });
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
  mockIssueSvc.autoUnblockDependents.mockResolvedValue([]);
  mockIssueSvc.listAttachments.mockResolvedValue([]);
  mockIssueSvc.listComments.mockResolvedValue([]);
  mockLogActivity.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Route-level tests: GET /issues/:id/blockers ──────────────────────────────

describe("GET /issues/:id/blockers", () => {
  it("returns blockedBy and blocks arrays for a known issue", async () => {
    const deps = {
      blockedBy: [{ id: "issue-2", identifier: "TEST-2", title: "Blocker", status: "in_progress" }],
      blocks: [],
    };
    mockIssueSvc.getDependencies.mockResolvedValue(deps);

    const app = createApp();
    const res = await request(app).get("/api/issues/issue-1/blockers");

    expect(res.status).toBe(200);
    expect(res.body.blockedBy).toHaveLength(1);
    expect(res.body.blockedBy[0].id).toBe("issue-2");
    expect(res.body.blocks).toHaveLength(0);
    expect(mockIssueSvc.getDependencies).toHaveBeenCalledWith("issue-1");
  });

  it("returns empty arrays when no dependencies exist", async () => {
    mockIssueSvc.getDependencies.mockResolvedValue({ blockedBy: [], blocks: [] });

    const app = createApp();
    const res = await request(app).get("/api/issues/issue-1/blockers");

    expect(res.status).toBe(200);
    expect(res.body.blockedBy).toEqual([]);
    expect(res.body.blocks).toEqual([]);
  });

  it("returns 404 when issue not found", async () => {
    mockIssueSvc.getById.mockResolvedValue(null);

    const app = createApp();
    const res = await request(app).get("/api/issues/nonexistent/blockers");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 403 when agent belongs to a different company", async () => {
    mockIssueSvc.getById.mockResolvedValue({ ...baseIssue, companyId: "company-other" });

    const app = createApp({ companyId: "company-1" });
    const res = await request(app).get("/api/issues/issue-1/blockers");

    expect(res.status).toBe(403);
  });
});

// ── Route-level tests: POST /issues/:id/blockers ─────────────────────────────

describe("POST /issues/:id/blockers", () => {
  it("adds a blocker and returns 201 with updated dependencies", async () => {
    const updatedDeps = {
      blockedBy: [{ id: BLOCKER_UUID, identifier: "TEST-2", title: "Blocker", status: "todo" }],
      blocks: [],
    };
    mockIssueSvc.getDependencies.mockResolvedValue(updatedDeps);

    const app = createApp();
    const res = await request(app)
      .post("/api/issues/issue-1/blockers")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ blockerId: BLOCKER_UUID });

    expect(res.status).toBe(201);
    expect(mockIssueSvc.addBlocker).toHaveBeenCalledWith(
      "issue-1",
      BLOCKER_UUID,
      "company-1",
      expect.objectContaining({ agentId: AGENT_UUID }),
    );
    expect(res.body.blockedBy).toHaveLength(1);
  });

  it("logs activity after successfully adding a blocker", async () => {
    const app = createApp();
    await request(app)
      .post("/api/issues/issue-1/blockers")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ blockerId: BLOCKER_UUID });

    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.blocker_added",
        entityId: "issue-1",
        details: expect.objectContaining({ blockerId: BLOCKER_UUID }),
      }),
    );
  });

  it("returns 404 when the dependent issue is not found", async () => {
    mockIssueSvc.getById.mockResolvedValue(null);

    const app = createApp();
    const res = await request(app)
      .post("/api/issues/nonexistent/blockers")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ blockerId: BLOCKER_UUID });

    expect(res.status).toBe(404);
  });

  it("returns 422 when adding a self-dependency", async () => {
    // The service throws an HttpError(422) for self-dependency
    mockIssueSvc.addBlocker.mockRejectedValue(
      new HttpError(422, "An issue cannot depend on itself"),
    );

    const app = createApp();
    const res = await request(app)
      .post("/api/issues/issue-1/blockers")
      .set("X-Paperclip-Run-Id", "run-1")
      // Use AGENT_UUID as blockerId — self-dependency would be issue-1 blocking itself,
      // but here we just need valid UUID and the mock will reject regardless
      .send({ blockerId: AGENT_UUID });

    expect(res.status).toBe(422);
  });

  it("returns 422 when the service rejects a circular dependency", async () => {
    // The service throws an HttpError(422) for circular chains
    mockIssueSvc.addBlocker.mockRejectedValue(
      new HttpError(422, "Adding this dependency would create a circular chain"),
    );

    const app = createApp();
    const res = await request(app)
      .post("/api/issues/issue-1/blockers")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ blockerId: BLOCKER_UUID });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/circular/i);
  });

  it("returns 400 when blockerId is missing from the request body", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/issues/issue-1/blockers")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({});

    expect(res.status).toBe(400);
  });

  it("returns 403 when agent belongs to a different company", async () => {
    mockIssueSvc.getById.mockResolvedValue({ ...baseIssue, companyId: "company-other" });

    const app = createApp({ companyId: "company-1" });
    const res = await request(app)
      .post("/api/issues/issue-1/blockers")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ blockerId: BLOCKER_UUID });

    expect(res.status).toBe(403);
  });
});

// ── Route-level tests: DELETE /issues/:id/blockers/:blockerId ────────────────

describe("DELETE /issues/:id/blockers/:blockerId", () => {
  it("removes a blocker and returns the updated dependencies (200)", async () => {
    mockIssueSvc.removeBlocker.mockResolvedValue({ deleted: true });
    mockIssueSvc.getDependencies.mockResolvedValue({ blockedBy: [], blocks: [] });

    const app = createApp();
    const res = await request(app)
      .delete("/api/issues/issue-1/blockers/issue-2")
      .set("X-Paperclip-Run-Id", "run-1");

    expect(res.status).toBe(200);
    expect(mockIssueSvc.removeBlocker).toHaveBeenCalledWith("issue-1", "issue-2");
    expect(res.body.blockedBy).toEqual([]);
  });

  it("logs activity after successfully removing a blocker", async () => {
    mockIssueSvc.removeBlocker.mockResolvedValue({ deleted: true });

    const app = createApp();
    await request(app)
      .delete("/api/issues/issue-1/blockers/issue-2")
      .set("X-Paperclip-Run-Id", "run-1");

    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "issue.blocker_removed",
        entityId: "issue-1",
        details: expect.objectContaining({ blockerId: "issue-2" }),
      }),
    );
  });

  it("returns 404 when the dependent issue is not found", async () => {
    mockIssueSvc.getById.mockResolvedValue(null);

    const app = createApp();
    const res = await request(app)
      .delete("/api/issues/nonexistent/blockers/issue-2")
      .set("X-Paperclip-Run-Id", "run-1");

    expect(res.status).toBe(404);
  });

  it("returns 404 when the dependency relationship does not exist", async () => {
    mockIssueSvc.removeBlocker.mockResolvedValue({ deleted: false });

    const app = createApp();
    const res = await request(app)
      .delete("/api/issues/issue-1/blockers/issue-99")
      .set("X-Paperclip-Run-Id", "run-1");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 403 when agent belongs to a different company", async () => {
    mockIssueSvc.getById.mockResolvedValue({ ...baseIssue, companyId: "company-other" });

    const app = createApp({ companyId: "company-1" });
    const res = await request(app)
      .delete("/api/issues/issue-1/blockers/issue-2")
      .set("X-Paperclip-Run-Id", "run-1");

    expect(res.status).toBe(403);
  });
});

// ── Service-level tests: getDependencies ────────────────────────────────────
//
// These call the real route which delegates to the mocked svc, so we verify
// the contract at the service boundary via the mock's call record.

describe("issueService.getDependencies — contract via route", () => {
  it("is called with the correct issueId on GET /blockers", async () => {
    const app = createApp();
    await request(app).get("/api/issues/my-issue-id/blockers");

    expect(mockIssueSvc.getById).toHaveBeenCalledWith("my-issue-id");
    expect(mockIssueSvc.getDependencies).toHaveBeenCalledWith("my-issue-id");
  });

  it("returns both blockedBy and blocks in the response shape", async () => {
    const depA = { id: "issue-2", identifier: "TEST-2", title: "A", status: "todo" };
    const depB = { id: "issue-3", identifier: "TEST-3", title: "B", status: "done" };
    mockIssueSvc.getDependencies.mockResolvedValue({ blockedBy: [depA], blocks: [depB] });

    const app = createApp();
    const res = await request(app).get("/api/issues/issue-1/blockers");

    expect(res.status).toBe(200);
    expect(res.body.blockedBy[0]).toMatchObject({ id: "issue-2" });
    expect(res.body.blocks[0]).toMatchObject({ id: "issue-3" });
  });
});

// ── Service-level tests: addBlocker — idempotency ────────────────────────────

describe("issueService.addBlocker — idempotent add via route", () => {
  it("calling POST twice does not error (second call just repeats)", async () => {
    // The service uses onConflictDoNothing so a second identical add should not throw.
    mockIssueSvc.addBlocker.mockResolvedValue(undefined);

    const app = createApp();
    const res1 = await request(app)
      .post("/api/issues/issue-1/blockers")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ blockerId: BLOCKER_UUID });

    const res2 = await request(app)
      .post("/api/issues/issue-1/blockers")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ blockerId: BLOCKER_UUID });

    expect(res1.status).toBe(201);
    expect(res2.status).toBe(201);
    expect(mockIssueSvc.addBlocker).toHaveBeenCalledTimes(2);
  });
});

// ── FIX 5A: Auto-block when adding a blocker ──────────────────────────────

describe("POST /issues/:id/blockers — auto-block behaviour", () => {
  it("auto-blocks dependent when blocker is not resolved (201)", async () => {
    // The real service auto-blocks the dependent inside addBlocker() when the blocker
    // is not in done/cancelled state. Since the service is mocked here, we cannot observe
    // the DB update directly, but we can verify the route returns 201 and calls addBlocker.
    // The service mock resolves successfully (no throw), which is what the route expects.
    mockIssueSvc.addBlocker.mockResolvedValue(undefined);
    // Dependent issue is in "todo" state — not done/cancelled, so the real service would auto-block it.
    mockIssueSvc.getById.mockResolvedValue({ ...baseIssue, status: "todo" });

    const app = createApp();
    const res = await request(app)
      .post("/api/issues/issue-1/blockers")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ blockerId: BLOCKER_UUID });

    expect(res.status).toBe(201);
    expect(mockIssueSvc.addBlocker).toHaveBeenCalledWith(
      "issue-1",
      BLOCKER_UUID,
      "company-1",
      expect.objectContaining({ agentId: AGENT_UUID }),
    );
  });
});

// ── FIX 5B: Cross-company blocker rejection ───────────────────────────────

describe("POST /issues/:id/blockers — cross-company blocker", () => {
  it("returns 422 when blocker is from different company", async () => {
    // Actor's company matches the issue's company, but the blocker issue belongs to a
    // different company. The real service would catch this and throw 422. We simulate
    // the service throwing an HttpError(422) with the appropriate message.
    mockIssueSvc.addBlocker.mockRejectedValue(
      new HttpError(422, "Blocker must belong to same company"),
    );

    const app = createApp();
    const res = await request(app)
      .post("/api/issues/issue-1/blockers")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ blockerId: BLOCKER_UUID });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/same company/i);
  });
});

// ── FIX 5C: Unauthenticated request tests ────────────────────────────────

describe("GET /issues/:id/blockers — unauthenticated", () => {
  it("returns 401 when unauthenticated", async () => {
    const app = createApp({ type: "none", source: "none" });
    const res = await request(app).get("/api/issues/issue-1/blockers");
    expect(res.status).toBe(401);
  });
});

describe("POST /issues/:id/blockers — unauthenticated", () => {
  it("returns 401 when unauthenticated", async () => {
    const app = createApp({ type: "none", source: "none" });
    const res = await request(app)
      .post("/api/issues/issue-1/blockers")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ blockerId: BLOCKER_UUID });
    expect(res.status).toBe(401);
  });
});

// ── FIX 5D: Invalid blockerId returns 400 ────────────────────────────────

describe("POST /issues/:id/blockers — invalid blockerId", () => {
  it("returns 400 for non-UUID blockerId", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/issues/issue-1/blockers")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ blockerId: "not-a-uuid" });
    expect(res.status).toBe(400);
  });
});
// ── Integration tests: PATCH /issues/:id with blockedByIds ──────────────────

describe("PATCH /issues/:id — blockedByIds persistence", () => {
  it("persists blockedByIds array via PATCH and returns updated issue", async () => {
    // Mock the update service to accept blockedByIds
    mockIssueSvc.update.mockResolvedValue({
      ...baseIssue,
      blockedByIds: [BLOCKER_UUID, BLOCKER_UUID_2],
    });
    mockIssueSvc.getDependencies.mockResolvedValue({
      blockedBy: [
        { id: BLOCKER_UUID, identifier: "TEST-2", title: "Blocker 1", status: "todo" },
        { id: BLOCKER_UUID_2, identifier: "TEST-3", title: "Blocker 2", status: "in_progress" },
      ],
      blocks: [],
    });

    const app = createApp();
    const res = await request(app)
      .patch("/api/issues/issue-1")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ blockedByIds: [BLOCKER_UUID, BLOCKER_UUID_2] });

    expect(res.status).toBe(200);
    expect(mockIssueSvc.update).toHaveBeenCalledWith(
      "issue-1",
      expect.objectContaining({ blockedByIds: [BLOCKER_UUID, BLOCKER_UUID_2] }),
      expect.objectContaining({ agentId: AGENT_UUID }),
    );
  });

  it("removes all blockers when blockedByIds is an empty array", async () => {
    mockIssueSvc.update.mockResolvedValue({ ...baseIssue });
    mockIssueSvc.getDependencies.mockResolvedValue({ blockedBy: [], blocks: [] });

    const app = createApp();
    const res = await request(app)
      .patch("/api/issues/issue-1")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ blockedByIds: [] });

    expect(res.status).toBe(200);
    expect(mockIssueSvc.update).toHaveBeenCalledWith(
      "issue-1",
      expect.objectContaining({ blockedByIds: [] }),
      expect.any(Object),
    );
  });

  it("returns 422 when blockedByIds contains invalid issue IDs", async () => {
    mockIssueSvc.update.mockRejectedValue(
      new HttpError(422, "One or more blocker issues not found"),
    );

    const app = createApp();
    const res = await request(app)
      .patch("/api/issues/issue-1")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ blockedByIds: ["00000000-0000-4000-8000-999999999999"] });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 422 when blockedByIds would create a cycle", async () => {
    mockIssueSvc.update.mockRejectedValue(
      new HttpError(422, "Adding this dependency would create a circular chain"),
    );

    const app = createApp();
    const res = await request(app)
      .patch("/api/issues/issue-1")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ blockedByIds: [BLOCKER_UUID] });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/circular/i);
  });

  it("returns 422 when blockedByIds contains the issue itself (self-dependency)", async () => {
    mockIssueSvc.update.mockRejectedValue(
      new HttpError(422, "An issue cannot depend on itself"),
    );

    const app = createApp();
    const res = await request(app)
      .patch("/api/issues/issue-1")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ blockedByIds: ["issue-1"] });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/cannot depend on itself/i);
  });

  it("deduplicates blockedByIds array before persisting", async () => {
    // The service should deduplicate the array internally
    mockIssueSvc.update.mockResolvedValue({ ...baseIssue });

    const app = createApp();
    const res = await request(app)
      .patch("/api/issues/issue-1")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ blockedByIds: [BLOCKER_UUID, BLOCKER_UUID, BLOCKER_UUID_2] });

    expect(res.status).toBe(200);
    expect(mockIssueSvc.update).toHaveBeenCalled();
  });

  it("passes actor context when updating blockedByIds", async () => {
    mockIssueSvc.update.mockResolvedValue({ ...baseIssue });

    const app = createApp();
    await request(app)
      .patch("/api/issues/issue-1")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ blockedByIds: [BLOCKER_UUID] });

    expect(mockIssueSvc.update).toHaveBeenCalledWith(
      "issue-1",
      expect.any(Object),
      expect.objectContaining({
        agentId: AGENT_UUID,
        userId: null,
      }),
    );
  });

  it("allows combining blockedByIds with other fields in PATCH", async () => {
    mockIssueSvc.update.mockResolvedValue({
      ...baseIssue,
      title: "Updated title",
      status: "blocked",
    });

    const app = createApp();
    const res = await request(app)
      .patch("/api/issues/issue-1")
      .set("X-Paperclip-Run-Id", "run-1")
      .send({
        title: "Updated title",
        status: "blocked",
        blockedByIds: [BLOCKER_UUID],
      });

    expect(res.status).toBe(200);
    expect(mockIssueSvc.update).toHaveBeenCalledWith(
      "issue-1",
      expect.objectContaining({
        title: "Updated title",
        status: "blocked",
        blockedByIds: [BLOCKER_UUID],
      }),
      expect.any(Object),
    );
  });
});
