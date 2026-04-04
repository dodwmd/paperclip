import express from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  update: vi.fn(),
  autoUnblockDependents: vi.fn().mockResolvedValue(undefined),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockTrackAgentTaskCompleted = vi.hoisted(() => vi.fn());
const mockGetTelemetryClient = vi.hoisted(() => vi.fn());

vi.mock("@paperclipai/shared/telemetry", () => ({
  trackAgentTaskCompleted: mockTrackAgentTaskCompleted,
}));

vi.mock("../telemetry.js", () => ({
  getTelemetryClient: mockGetTelemetryClient,
}));

vi.mock("../services/index.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    accessService: () => ({
      canUser: vi.fn(),
      hasPermission: vi.fn(),
    }),
    agentService: () => mockAgentService,
    companyService: () => ({ getById: vi.fn().mockResolvedValue(null) }),
    documentService: () => ({}),
    executionWorkspaceService: () => ({}),
    feedbackService: () => ({}),
    goalService: () => ({}),
    heartbeatService: () => ({
      reportRunActivity: vi.fn(async () => undefined),
    }),
    instanceSettingsService: () => ({}),
    issueApprovalService: () => ({}),
    issueService: () => mockIssueService,
    logActivity: vi.fn(async () => undefined),
    projectService: () => ({}),
    routineService: () => ({
      syncRunStatusForIssue: vi.fn(async () => undefined),
    }),
    workProductService: () => ({}),
  };
});

function makeIssue(status: "todo" | "done") {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "company-1",
    status,
    assigneeAgentId: "22222222-2222-4222-8222-222222222222",
    assigneeUserId: null,
    createdByUserId: "local-board",
    identifier: "PAP-1018",
    title: "Telemetry test",
  };
}

function createApp(actor: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

describe("issue telemetry routes", () => {
  const origEnv = process.env.KANBAN_ENFORCEMENT_ENABLED;
  afterAll(() => {
    if (origEnv === undefined) delete process.env.KANBAN_ENFORCEMENT_ENABLED;
    else process.env.KANBAN_ENFORCEMENT_ENABLED = origEnv;
  });
  beforeEach(() => {
    process.env.KANBAN_ENFORCEMENT_ENABLED = "false";
    vi.clearAllMocks();
    mockGetTelemetryClient.mockReturnValue({ track: vi.fn() });
    mockIssueService.getById.mockResolvedValue(makeIssue("todo"));
    mockIssueService.update.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({
      ...makeIssue("todo"),
      ...patch,
    }));
  });

  it("emits task-completed telemetry with the agent role", async () => {
    mockAgentService.getById.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      role: "engineer",
      adapterType: "codex_local",
    });

    const res = await request(createApp({
      type: "agent",
      agentId: "agent-1",
      companyId: "company-1",
      runId: null,
    }))
      .patch("/api/issues/11111111-1111-4111-8111-111111111111")
      .send({ status: "done" });

    expect(res.status).toBe(200);
    expect(mockTrackAgentTaskCompleted).toHaveBeenCalledWith(expect.anything(), {
      agentRole: "engineer",
    });
  });

  it("does not emit agent task-completed telemetry for board-driven completions", async () => {
    const res = await request(createApp({
      type: "board",
      userId: "local-board",
      companyIds: ["company-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
    }))
      .patch("/api/issues/11111111-1111-4111-8111-111111111111")
      .send({ status: "done" });

    expect(res.status).toBe(200);
    expect(mockTrackAgentTaskCompleted).not.toHaveBeenCalled();
    expect(mockAgentService.getById).not.toHaveBeenCalled();
  });
});
