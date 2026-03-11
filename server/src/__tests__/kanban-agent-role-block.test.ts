/**
 * Tests for the agent role-change block in PATCH /agents/:id.
 *
 * Security-critical: an agent actor must not be able to change role fields
 * to prevent privilege escalation. A board actor must be able to change roles.
 *
 * Agent IDs must be proper UUIDs to pass through the agents route's
 * normalizeAgentReference() param middleware (isUuidLike check).
 */
import express, { type Request } from "express";
import request from "supertest";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { errorHandler } from "../middleware/error-handler.js";

// Proper UUIDs so the agents router's router.param("id") normalizeAgentReference
// passes through without requiring a companyId query parameter.
const AGENT_UUID = "00000000-0000-4000-8000-000000000001";
const AGENT_UUID_2 = "00000000-0000-4000-8000-000000000002";

// Use vi.hoisted() for stable mock references before module factory runs.
const { mockAgentSvc, mockAccessSvc, mockLogActivity } = vi.hoisted(() => {
  const mockAgentSvc = {
    getById: vi.fn(),
    update: vi.fn(),
  };
  const mockAccessSvc = {
    canUser: vi.fn().mockResolvedValue(true),
    hasPermission: vi.fn().mockResolvedValue(false),
  };
  const mockLogActivity = vi.fn().mockResolvedValue(undefined);
  return { mockAgentSvc, mockAccessSvc, mockLogActivity };
});

vi.mock("../services/index.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    agentService: () => mockAgentSvc,
    accessService: () => mockAccessSvc,
    heartbeatService: () => ({
      wakeup: vi.fn(),
      getRun: vi.fn(),
      getActiveRunForAgent: vi.fn(),
      cancelRun: vi.fn(),
    }),
    approvalService: () => ({ listForAgent: vi.fn().mockResolvedValue([]) }),
    issueApprovalService: () => ({
      listApprovalsForIssue: vi.fn().mockResolvedValue([]),
      link: vi.fn(),
      unlink: vi.fn(),
    }),
    issueService: () => ({
      getById: vi.fn().mockResolvedValue(null),
    }),
    secretService: () => ({
      normalizeAdapterConfigForPersistence: vi.fn().mockResolvedValue({}),
      resolveAdapterConfigForRuntime: vi.fn().mockResolvedValue({ config: {} }),
    }),
    logActivity: mockLogActivity,
  };
});

import { agentRoutes } from "../routes/agents.js";

// ── Fixtures ─────────────────────────────────────────────────────────────

const baseAgent = {
  id: AGENT_UUID,
  companyId: "company-1",
  name: "Test Agent",
  role: "engineer",
  status: "active",
  permissions: null,
  adapterType: "process",
  adapterConfig: {},
};

// ── App factory ───────────────────────────────────────────────────────────

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
  app.use("/api", agentRoutes({} as any));
  app.use(errorHandler);
  return app;
}

// ── Test setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  mockAgentSvc.getById.mockResolvedValue({ ...baseAgent });
  mockAgentSvc.update.mockResolvedValue({ ...baseAgent });
  mockAccessSvc.canUser.mockResolvedValue(true);
  mockAccessSvc.hasPermission.mockResolvedValue(false);
  mockLogActivity.mockResolvedValue(undefined);
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe("PATCH /agents/:id — agent role-change block", () => {
  it("agent actor cannot change own role → 403", async () => {
    const app = createApp();
    const res = await request(app)
      .patch(`/api/agents/${AGENT_UUID}`)
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ role: "ceo" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/role/i);
  });

  it("agent actor (CEO) cannot change another agent's role → 403", async () => {
    // actor is AGENT_UUID (CEO), target is AGENT_UUID_2 (engineer)
    const targetAgent = { ...baseAgent, id: AGENT_UUID_2 };
    // First getById call is for the target agent (route lookup)
    // Second getById call is for the actor in assertCanUpdateAgent
    mockAgentSvc.getById
      .mockResolvedValueOnce(targetAgent)                        // target: AGENT_UUID_2
      .mockResolvedValueOnce({ ...baseAgent, role: "ceo" });     // actor: AGENT_UUID (CEO)

    const app = createApp();
    const res = await request(app)
      .patch(`/api/agents/${AGENT_UUID_2}`)
      .set("X-Paperclip-Run-Id", "run-1")
      .send({ role: "devops" });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/role/i);
  });

  it("board actor can change agent role → 200", async () => {
    mockAgentSvc.update.mockResolvedValue({ ...baseAgent, role: "devops" });

    const app = createApp({
      type: "board",
      userId: "board-user",
      source: "local_implicit",
    });
    const res = await request(app)
      .patch(`/api/agents/${AGENT_UUID}`)
      .set("Origin", "http://localhost:3100")
      .send({ name: "Updated Name", role: "devops" });

    expect(res.status).toBe(200);
  });
});
