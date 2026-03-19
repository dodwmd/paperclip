import type { CompanyStatus, PauseReason } from "../constants.js";
import type { KanbanConfig } from "../kanban-policy.js";

export interface Company {
  id: string;
  name: string;
  description: string | null;
  status: CompanyStatus;
  pauseReason: PauseReason | null;
  pausedAt: Date | null;
  issuePrefix: string;
  issueCounter: number;
  budgetMonthlyCents: number;
  spentMonthlyCents: number;
  requireBoardApprovalForNewAgents: boolean;
  brandColor: string | null;
  kanbanConfig: KanbanConfig | null;
  kanbanGitUrl: string | null;
  kanbanLastSyncedAt: Date | null;
  kanbanLastSyncError: string | null;
  kanbanGitSha: string | null;
  logoAssetId: string | null;
  logoUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}
