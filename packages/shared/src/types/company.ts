import type { CompanyStatus } from "../constants.js";
import type { KanbanConfig } from "../kanban-policy.js";

export interface Company {
  id: string;
  name: string;
  description: string | null;
  status: CompanyStatus;
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
