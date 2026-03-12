/**
 * Tests for persona-sync functionality.
 *
 * Covers:
 *  - Unit tests for parseGitHubTreeUrl()
 *  - Unit tests for syncAgentPersona() with mocked fetch and db
 *  - Route tests for POST /agents/:id/sync-persona
 *
 * Uses vi.mock() for service and module mocking — no real network or DB required.
 */
import express, { type Request } from "express";
import request from "supertest";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { parseGitHubTreeUrl } from "../services/persona-sync.js";
import { errorHandler } from "../middleware/error-handler.js";

// ── Stable mock references (hoisted) ────────────────────────────────────────

const {
  mockAgentSvc,
  mockSyncAgentPersona,
  mockLogActivity,
  mockEnsureAgentHomeDir,
} = vi.hoisted(() => {
  const mockAgentSvc = {
    getById: vi.fn(),
    update: vi.fn(),
    resolveByReference: vi.fn(),
  };
  const mockSyncAgentPersona = vi.fn();
  const mockLogActivity = vi.fn();
  const mockEnsureAgentHomeDir = vi.fn();
  return { mockAgentSvc, mockSyncAgentPersona, mockLogActivity, mockEnsureAgentHomeDir };
});

vi.mock("../services/index.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    agentService: () => mockAgentSvc,
    accessService: () => ({
      canUser: vi.fn().mockResolvedValue(true),
      hasPermission: vi.fn().mockResolvedValue(false),
    }),
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
    issueService: () => ({ getById: vi.fn().mockResolvedValue(null) }),
    secretService: () => ({
      normalizeAdapterConfigForPersistence: vi.fn().mockResolvedValue({}),
      resolveAdapterConfigForRuntime: vi.fn().mockResolvedValue({ config: {} }),
    }),
    syncAgentPersona: mockSyncAgentPersona,
    logActivity: mockLogActivity,
  };
});

// Mock agent-home so persona-sync's ensureAgentHomeDir doesn't touch the FS
vi.mock("../agent-home.js", () => ({
  ensureAgentHomeDir: mockEnsureAgentHomeDir,
  writeInstructionFile: vi.fn().mockResolvedValue(undefined),
  INSTRUCTION_FILES: ["AGENTS.md", "HEARTBEAT.md", "SOUL.md", "TOOLS.md"],
}));

// Mock activity-log so the real logActivity doesn't need a real DB.
// Use the same mockLogActivity reference from vi.hoisted() so direct unit tests
// (calling realSyncAgentPersona) can assert on the same mock.
vi.mock("../services/activity-log.js", () => ({
  logActivity: mockLogActivity,
}));

// Mock node:fs/promises so persona-sync's fs.writeFile / fs.mkdir don't touch real FS
vi.mock("node:fs/promises", () => ({
  default: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
    access: vi.fn().mockResolvedValue(undefined),
    cp: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(""),
  },
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  cp: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue(""),
}));

import { syncAgentPersona as realSyncAgentPersona } from "../services/persona-sync.js";
import { agentRoutes } from "../routes/agents.js";

// ── Data fixtures ────────────────────────────────────────────────────────────

const AGENT_UUID = "00000000-0000-4000-8000-000000000001";

const baseAgent = {
  id: AGENT_UUID,
  companyId: "company-1",
  name: "Test Agent",
  role: "engineer",
  status: "active",
  permissions: null,
  adapterType: null,
  adapterConfig: {},
  personaGitUrl: "https://github.com/owner/repo/tree/main/personas/test-agent",
};

// ── App factory ──────────────────────────────────────────────────────────────

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

// ── Test Setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  mockAgentSvc.getById.mockResolvedValue({ ...baseAgent });
  mockAgentSvc.update.mockResolvedValue({ ...baseAgent });
  mockLogActivity.mockResolvedValue(undefined);
  mockEnsureAgentHomeDir.mockResolvedValue("/tmp/test-agent-home");
  mockSyncAgentPersona.mockResolvedValue({
    ok: true,
    syncedAt: new Date(),
    filesSynced: ["AGENTS.md"],
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Unit tests: parseGitHubTreeUrl ───────────────────────────────────────────

describe("parseGitHubTreeUrl()", () => {
  it("parses a full tree URL with a subdirectory", () => {
    const result = parseGitHubTreeUrl(
      "https://github.com/owner/repo/tree/main/subdir",
    );
    expect(result).toEqual({
      owner: "owner",
      repo: "repo",
      branch: "main",
      subdir: "subdir",
    });
  });

  it("parses a full tree URL with nested subdirectory", () => {
    const result = parseGitHubTreeUrl(
      "https://github.com/my-org/my-repo/tree/develop/personas/agent-alpha",
    );
    expect(result).toEqual({
      owner: "my-org",
      repo: "my-repo",
      branch: "develop",
      subdir: "personas/agent-alpha",
    });
  });

  it("parses a bare repo URL (no tree/branch/path) using 'master' default with empty subdir", () => {
    const result = parseGitHubTreeUrl("https://github.com/owner/repo");
    expect(result).toEqual({
      owner: "owner",
      repo: "repo",
      branch: "master",
      subdir: "",
    });
  });

  it("strips .git suffix from a bare repo URL", () => {
    const result = parseGitHubTreeUrl("https://github.com/owner/repo.git");
    expect(result).toEqual({
      owner: "owner",
      repo: "repo",
      branch: "master",
      subdir: "",
    });
  });

  it("returns null for a non-GitHub URL", () => {
    const result = parseGitHubTreeUrl("https://gitlab.com/owner/repo");
    expect(result).toBeNull();
  });

  it("returns null for a completely invalid URL string", () => {
    const result = parseGitHubTreeUrl("not-a-url");
    expect(result).toBeNull();
  });

  it("returns null when owner or repo are missing", () => {
    const result = parseGitHubTreeUrl("https://github.com/");
    expect(result).toBeNull();
  });

  it("handles a tree URL with no subdirectory (just owner/repo/tree/branch)", () => {
    const result = parseGitHubTreeUrl(
      "https://github.com/owner/repo/tree/main",
    );
    expect(result).toEqual({
      owner: "owner",
      repo: "repo",
      branch: "main",
      subdir: "",
    });
  });
});

// ── Route tests: POST /agents/:id/sync-persona ───────────────────────────────

describe("POST /agents/:id/sync-persona", () => {
  it("returns 200 with sync result on success", async () => {
    const syncedAt = new Date("2026-01-01T00:00:00Z");
    mockSyncAgentPersona.mockResolvedValue({
      ok: true,
      syncedAt,
      filesSynced: ["AGENTS.md", "SOUL.md"],
    });

    const app = createApp();
    const res = await request(app)
      .post(`/api/agents/${AGENT_UUID}/sync-persona`)
      .set("X-Paperclip-Run-Id", "run-1");

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.filesSynced).toContain("AGENTS.md");
  });

  it("calls syncAgentPersona with correct agent info", async () => {
    const app = createApp();
    await request(app)
      .post(`/api/agents/${AGENT_UUID}/sync-persona`)
      .set("X-Paperclip-Run-Id", "run-1");

    expect(mockSyncAgentPersona).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: AGENT_UUID,
        companyId: "company-1",
        personaGitUrl: baseAgent.personaGitUrl,
      }),
      expect.objectContaining({
        actorType: "agent",
        agentId: AGENT_UUID,
        runId: "run-1",
      }),
    );
  });

  it("returns 404 when agent is not found", async () => {
    mockAgentSvc.getById.mockResolvedValue(null);

    const app = createApp();
    const res = await request(app)
      .post(`/api/agents/${AGENT_UUID}/sync-persona`)
      .set("X-Paperclip-Run-Id", "run-1");

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("returns 422 when personaGitUrl is not configured", async () => {
    mockAgentSvc.getById.mockResolvedValue({ ...baseAgent, personaGitUrl: null });

    const app = createApp();
    const res = await request(app)
      .post(`/api/agents/${AGENT_UUID}/sync-persona`)
      .set("X-Paperclip-Run-Id", "run-1");

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/personaGitUrl/i);
  });

  it("returns 422 when sync fails with the error message from the service", async () => {
    mockSyncAgentPersona.mockResolvedValue({
      ok: false,
      error: "Path not found in repository: /",
    });

    const app = createApp();
    const res = await request(app)
      .post(`/api/agents/${AGENT_UUID}/sync-persona`)
      .set("X-Paperclip-Run-Id", "run-1");

    expect(res.status).toBe(422);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/path not found/i);
  });

  it("returns 403 when agent belongs to a different company", async () => {
    mockAgentSvc.getById.mockResolvedValue({ ...baseAgent, companyId: "company-other" });

    const app = createApp({ companyId: "company-1" });
    const res = await request(app)
      .post(`/api/agents/${AGENT_UUID}/sync-persona`)
      .set("X-Paperclip-Run-Id", "run-1");

    expect(res.status).toBe(403);
  });
});

// ── Unit tests: syncAgentPersona — direct with mocked fetch + db ─────────────
//
// These test the real syncAgentPersona implementation, mocking only fetch and
// the DB stub. The agent-home and activity-log modules are already mocked above.

describe("syncAgentPersona() — direct unit tests", () => {
  // realSyncAgentPersona is imported at the top of this file;
  // the agent-home and activity-log modules are mocked at file level above.

  function createDbStub() {
    return {
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue([]),
      }),
    };
  }

  beforeEach(() => {
    // Ensure ensureAgentHomeDir is always mocked for the direct tests
    mockEnsureAgentHomeDir.mockResolvedValue("/tmp/test-agent-home");
  });

  it("happy path: downloads files, updates agent metadata, logs success activity", async () => {
    const fileContent = "# Test AGENTS.md content";
    const directoryListing = [
      {
        name: "AGENTS.md",
        type: "file",
        download_url: "https://raw.githubusercontent.com/owner/repo/main/AGENTS.md",
        path: "AGENTS.md",
      },
    ];

    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => directoryListing,
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => fileContent,
      } as unknown as Response),
    );

    // node:fs/promises is already mocked at the top of this file

    const mockDb = createDbStub();

    const result = await realSyncAgentPersona(
      mockDb as any,
      {
        id: AGENT_UUID,
        companyId: "company-1",
        personaGitUrl: "https://github.com/owner/repo/tree/main",
      },
      {
        actorType: "agent",
        actorId: AGENT_UUID,
        agentId: AGENT_UUID,
        runId: "run-1",
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.filesSynced).toContain("AGENTS.md");
    }
    // DB update should have been called to store sync metadata
    expect(mockDb.update).toHaveBeenCalled();
    // FIX 6A: ensureAgentHomeDir must be called with the agent id
    expect(mockEnsureAgentHomeDir).toHaveBeenCalledWith(AGENT_UUID);
    // logActivity should be called with agent.persona_synced
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "agent.persona_synced" }),
    );

    vi.unstubAllGlobals();
  });

  it("failure path: GitHub 404 returns ok=false and stores error in DB", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: async () => "Not Found",
    } as unknown as Response));

    const mockDb = createDbStub();

    const result = await realSyncAgentPersona(
      mockDb as any,
      {
        id: AGENT_UUID,
        companyId: "company-1",
        personaGitUrl: "https://github.com/owner/repo/tree/main",
      },
      {
        actorType: "agent",
        actorId: AGENT_UUID,
        agentId: AGENT_UUID,
        runId: "run-1",
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // The error message comes from fetchGitHubContents: "Path not found in repository: /"
      expect(result.error).toMatch(/path not found/i);
    }
    // DB should be updated to store the error
    expect(mockDb.update).toHaveBeenCalled();
    // logActivity should be called with agent.persona_sync_failed
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "agent.persona_sync_failed" }),
    );

    vi.unstubAllGlobals();
  });

  it("invalid personaGitUrl: returns ok=false without calling fetch", async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);

    const mockDb = createDbStub();

    const result = await realSyncAgentPersona(
      mockDb as any,
      {
        id: AGENT_UUID,
        companyId: "company-1",
        personaGitUrl: "not-a-valid-url",
      },
      {
        actorType: "agent",
        actorId: AGENT_UUID,
        agentId: AGENT_UUID,
        runId: "run-1",
      },
    );

    expect(result.ok).toBe(false);
    expect(mockFetch).not.toHaveBeenCalled();
    // DB should be updated to store the validation error
    expect(mockDb.update).toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  // FIX 6B: .claude/ directory recursion test
  it(".claude/ directory: makes a second fetch call and writes files with .claude/ prefix", async () => {
    const claudeFileContent = "# Claude settings";
    const directoryListing = [
      {
        name: ".claude",
        type: "dir",
        download_url: null,
        path: ".claude",
      },
    ];
    const claudeListing = [
      {
        name: "settings.json",
        type: "file",
        download_url: "https://raw.githubusercontent.com/owner/repo/main/.claude/settings.json",
        path: ".claude/settings.json",
      },
    ];

    const mockFetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => directoryListing,
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => claudeListing,
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => claudeFileContent,
      } as unknown as Response);

    vi.stubGlobal("fetch", mockFetch);

    const mockDb = createDbStub();

    const result = await realSyncAgentPersona(
      mockDb as any,
      {
        id: AGENT_UUID,
        companyId: "company-1",
        personaGitUrl: "https://github.com/owner/repo/tree/main",
      },
      {
        actorType: "agent",
        actorId: AGENT_UUID,
        agentId: AGENT_UUID,
        runId: "run-1",
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      // File inside .claude/ should be listed with .claude/ prefix
      expect(result.filesSynced).toContain(".claude/settings.json");
    }
    // Two GitHub API fetch calls were made: once for the root dir and once for .claude/
    const githubApiFetchCalls = mockFetch.mock.calls.filter((call: unknown[]) =>
      typeof call[0] === "string" && call[0].includes("api.github.com"),
    );
    expect(githubApiFetchCalls.length).toBeGreaterThanOrEqual(2);

    vi.unstubAllGlobals();
  });
});

// ── FIX 6C: Unauthenticated request for sync-persona route ───────────────

describe("POST /agents/:id/sync-persona — unauthenticated", () => {
  it("returns 401 when unauthenticated", async () => {
    const app = createApp({ type: "none", source: "none" });
    const res = await request(app)
      .post(`/api/agents/${AGENT_UUID}/sync-persona`)
      .set("X-Paperclip-Run-Id", "run-1");
    expect(res.status).toBe(401);
  });
});
