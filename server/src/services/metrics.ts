import { and, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, heartbeatRuns } from "@paperclipai/db";
import type { ToolUsageItem, ToolUsageByAgent, RunStats } from "@paperclipai/shared";

export interface MetricsDateRange {
  from?: Date;
  to?: Date;
}

export function metricsService(db: Db) {
  function rangeConditions(range?: MetricsDateRange) {
    const conds: ReturnType<typeof eq>[] = [];
    if (range?.from) conds.push(gte(heartbeatRuns.finishedAt, range.from));
    if (range?.to) conds.push(lte(heartbeatRuns.finishedAt, range.to));
    return conds;
  }

  return {
    toolUsage: async (companyId: string, range?: MetricsDateRange): Promise<ToolUsageItem[]> => {
      const conditions = [
        eq(heartbeatRuns.companyId, companyId),
        isNotNull(heartbeatRuns.toolCallsJson),
        ...rangeConditions(range),
      ];

      const runs = await db
        .select({ toolCallsJson: heartbeatRuns.toolCallsJson })
        .from(heartbeatRuns)
        .where(and(...conditions));

      const totals: Record<string, number> = {};
      for (const run of runs) {
        if (!run.toolCallsJson) continue;
        for (const [tool, count] of Object.entries(run.toolCallsJson)) {
          totals[tool] = (totals[tool] ?? 0) + Number(count);
        }
      }

      return Object.entries(totals)
        .map(([toolName, callCount]) => ({
          toolName,
          callCount,
          isMcp: toolName.startsWith("mcp__"),
        }))
        .sort((a, b) => b.callCount - a.callCount);
    },

    toolUsageByAgent: async (companyId: string, range?: MetricsDateRange): Promise<ToolUsageByAgent[]> => {
      const conditions = [
        eq(heartbeatRuns.companyId, companyId),
        isNotNull(heartbeatRuns.toolCallsJson),
        ...rangeConditions(range),
      ];

      const runs = await db
        .select({
          agentId: heartbeatRuns.agentId,
          agentName: agents.name,
          agentStatus: agents.status,
          toolCallsJson: heartbeatRuns.toolCallsJson,
        })
        .from(heartbeatRuns)
        .leftJoin(agents, eq(heartbeatRuns.agentId, agents.id))
        .where(and(...conditions));

      const agentMap = new Map<string, {
        agentName: string | null;
        agentStatus: string | null;
        totals: Record<string, number>;
      }>();

      for (const run of runs) {
        if (!run.toolCallsJson) continue;
        let entry = agentMap.get(run.agentId);
        if (!entry) {
          entry = {
            agentName: run.agentName ?? null,
            agentStatus: run.agentStatus ?? null,
            totals: {},
          };
          agentMap.set(run.agentId, entry);
        }
        for (const [tool, count] of Object.entries(run.toolCallsJson)) {
          entry.totals[tool] = (entry.totals[tool] ?? 0) + Number(count);
        }
      }

      return Array.from(agentMap.entries())
        .map(([agentId, { agentName, agentStatus, totals }]) => {
          const toolCalls: ToolUsageItem[] = Object.entries(totals)
            .map(([toolName, callCount]) => ({
              toolName,
              callCount,
              isMcp: toolName.startsWith("mcp__"),
            }))
            .sort((a, b) => b.callCount - a.callCount);
          const totalCalls = toolCalls.reduce((sum, t) => sum + t.callCount, 0);
          return { agentId, agentName, agentStatus, toolCalls, totalCalls };
        })
        .sort((a, b) => b.totalCalls - a.totalCalls);
    },

    runStats: async (companyId: string, range?: MetricsDateRange): Promise<RunStats> => {
      const conditions = [
        eq(heartbeatRuns.companyId, companyId),
        isNotNull(heartbeatRuns.startedAt),
        isNotNull(heartbeatRuns.finishedAt),
        ...rangeConditions(range),
      ];

      const rows = await db
        .select({
          status: heartbeatRuns.status,
          durationSec: sql<number>`EXTRACT(EPOCH FROM (${heartbeatRuns.finishedAt} - ${heartbeatRuns.startedAt}))`,
        })
        .from(heartbeatRuns)
        .where(and(...conditions));

      if (rows.length === 0) {
        return {
          totalRuns: 0,
          succeededRuns: 0,
          failedRuns: 0,
          cancelledRuns: 0,
          avgDurationSec: null,
          maxDurationSec: null,
        };
      }

      let succeededRuns = 0;
      let failedRuns = 0;
      let cancelledRuns = 0;
      let durationSum = 0;
      let durationMax = 0;
      let durationCount = 0;

      for (const row of rows) {
        if (row.status === "succeeded") succeededRuns++;
        else if (row.status === "cancelled") cancelledRuns++;
        else if (row.status !== "queued" && row.status !== "running") failedRuns++;

        const dur = Number(row.durationSec);
        if (Number.isFinite(dur) && dur >= 0) {
          durationSum += dur;
          if (dur > durationMax) durationMax = dur;
          durationCount++;
        }
      }

      return {
        totalRuns: rows.length,
        succeededRuns,
        failedRuns,
        cancelledRuns,
        avgDurationSec: durationCount > 0 ? Number((durationSum / durationCount).toFixed(2)) : null,
        maxDurationSec: durationCount > 0 ? Number(durationMax.toFixed(2)) : null,
      };
    },
  };
}
