export interface ToolUsageItem {
  toolName: string;
  callCount: number;
  isMcp: boolean;
}

export interface ToolUsageByAgent {
  agentId: string;
  agentName: string | null;
  agentStatus: string | null;
  toolCalls: ToolUsageItem[];
  totalCalls: number;
}

export interface RunStats {
  totalRuns: number;
  succeededRuns: number;
  failedRuns: number;
  cancelledRuns: number;
  avgDurationSec: number | null;
  maxDurationSec: number | null;
}
