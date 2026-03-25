import type {
  Company,
  CompanyPortabilityExportRequest,
  CompanyPortabilityExportPreviewResult,
  CompanyPortabilityExportResult,
  KanbanConfig,
  CompanyPortabilityImportRequest,
  CompanyPortabilityImportResult,
  CompanyPortabilityPreviewRequest,
  CompanyPortabilityPreviewResult,
  UpdateCompanyBranding,
} from "@paperclipai/shared";
import { api } from "./client";

export type CompanyStats = Record<string, { agentCount: number; issueCount: number }>;

export const companiesApi = {
  list: () => api.get<Company[]>("/companies"),
  get: (companyId: string) => api.get<Company>(`/companies/${companyId}`),
  stats: () => api.get<CompanyStats>("/companies/stats"),
  create: (data: {
    name: string;
    description?: string | null;
    budgetMonthlyCents?: number;
  }) =>
    api.post<Company>("/companies", data),
  update: (
    companyId: string,
    data: Partial<
      Pick<
        Company,
        "name" | "description" | "status" | "budgetMonthlyCents" | "requireBoardApprovalForNewAgents" | "brandColor" | "kanbanGitUrl" | "logoAssetId"
      >
    >,
  ) => api.patch<Company>(`/companies/${companyId}`, data),
  updateBranding: (companyId: string, data: UpdateCompanyBranding) =>
    api.patch<Company>(`/companies/${companyId}/branding`, data),
  archive: (companyId: string) => api.post<Company>(`/companies/${companyId}/archive`, {}),
  remove: (companyId: string) => api.delete<{ ok: true }>(`/companies/${companyId}`),
  exportBundle: (
    companyId: string,
    data: CompanyPortabilityExportRequest,
  ) =>
    api.post<CompanyPortabilityExportResult>(`/companies/${companyId}/export`, data),
  exportPreview: (
    companyId: string,
    data: CompanyPortabilityExportRequest,
  ) =>
    api.post<CompanyPortabilityExportPreviewResult>(`/companies/${companyId}/exports/preview`, data),
  exportPackage: (
    companyId: string,
    data: CompanyPortabilityExportRequest,
  ) =>
    api.post<CompanyPortabilityExportResult>(`/companies/${companyId}/exports`, data),
  importPreview: (data: CompanyPortabilityPreviewRequest) =>
    api.post<CompanyPortabilityPreviewResult>("/companies/import/preview", data),
  importBundle: (data: CompanyPortabilityImportRequest) =>
    api.post<CompanyPortabilityImportResult>("/companies/import", data),
  getKanbanConfig: (companyId: string) =>
    api.get<{ config: KanbanConfig | null }>(`/companies/${companyId}/kanban-config`),
  updateKanbanConfig: (companyId: string, config: KanbanConfig | null) =>
    api.put<Company>(`/companies/${companyId}/kanban-config`, { config }),

  syncKanbanConfig: (companyId: string) =>
    api.post<{
      ok: boolean;
      syncedAt?: string;
      sha?: string;
      columnsCount?: number;
      rulesCount?: number;
      error?: string;
    }>(`/companies/${companyId}/sync-kanban-config`, {}),

  checkKanbanGitStatus: (companyId: string) =>
    api.get<{
      remoteSha: string | null;
      localSha: string | null;
      inSync: boolean;
      fetchError: boolean;
    }>(`/companies/${companyId}/kanban-git-status`),
};
