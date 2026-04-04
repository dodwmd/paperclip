import { ChangeEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_FEEDBACK_DATA_SHARING_TERMS_VERSION } from "@paperclipai/shared";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useToast } from "../context/ToastContext";
import { companiesApi } from "../api/companies";
import { accessApi } from "../api/access";
import { secretsApi } from "../api/secrets";
import { assetsApi } from "../api/assets";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Settings, Check, Eye, EyeOff, RotateCcw, Trash2, Plus, KeyRound, Loader2, X, Download, Upload } from "lucide-react";
import { cn } from "../lib/utils";
import { CompanyPatternIcon } from "../components/CompanyPatternIcon";
import {
  Field,
  ToggleField,
  HintIcon
} from "../components/agent-config-primitives";
import { KanbanConfigEditor } from "../components/KanbanConfigEditor";
import type { CompanySecret, KanbanConfig } from "@paperclipai/shared";

type AgentSnippetInput = {
  onboardingTextUrl: string;
  connectionCandidates?: string[] | null;
  testResolutionUrl?: string | null;
};

const FEEDBACK_TERMS_URL = import.meta.env.VITE_FEEDBACK_TERMS_URL?.trim() || "https://paperclip.ing/tos";

export function CompanySettings() {
  const {
    companies,
    selectedCompany,
    selectedCompanyId,
    setSelectedCompanyId
  } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { pushToast } = useToast();
  const queryClient = useQueryClient();
  // General settings local state
  const [companyName, setCompanyName] = useState("");
  const [description, setDescription] = useState("");
  const [brandColor, setBrandColor] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoUploadError, setLogoUploadError] = useState<string | null>(null);

  // Sync local state from selected company
  useEffect(() => {
    if (!selectedCompany) return;
    setCompanyName(selectedCompany.name);
    setDescription(selectedCompany.description ?? "");
    setBrandColor(selectedCompany.brandColor ?? "");
    setLogoUrl(selectedCompany.logoUrl ?? "");
  }, [selectedCompany]);

  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteSnippet, setInviteSnippet] = useState<string | null>(null);
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [snippetCopyDelightId, setSnippetCopyDelightId] = useState(0);

  const generalDirty =
    !!selectedCompany &&
    (companyName !== selectedCompany.name ||
      description !== (selectedCompany.description ?? "") ||
      brandColor !== (selectedCompany.brandColor ?? ""));

  const generalMutation = useMutation({
    mutationFn: (data: {
      name: string;
      description: string | null;
      brandColor: string | null;
    }) => companiesApi.update(selectedCompanyId!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    }
  });

  const settingsMutation = useMutation({
    mutationFn: (requireApproval: boolean) =>
      companiesApi.update(selectedCompanyId!, {
        requireBoardApprovalForNewAgents: requireApproval
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    }
  });

  const feedbackSharingMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      companiesApi.update(selectedCompanyId!, {
        feedbackDataSharingEnabled: enabled,
      }),
    onSuccess: (_company, enabled) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      pushToast({
        title: enabled ? "Feedback sharing enabled" : "Feedback sharing disabled",
        tone: "success",
      });
    },
    onError: (err) => {
      pushToast({
        title: "Failed to update feedback sharing",
        body: err instanceof Error ? err.message : "Unknown error",
        tone: "error",
      });
    },
  });

  const inviteMutation = useMutation({
    mutationFn: () =>
      accessApi.createOpenClawInvitePrompt(selectedCompanyId!),
    onSuccess: async (invite) => {
      setInviteError(null);
      const base = window.location.origin.replace(/\/+$/, "");
      const onboardingTextLink =
        invite.onboardingTextUrl ??
        invite.onboardingTextPath ??
        `/api/invites/${invite.token}/onboarding.txt`;
      const absoluteUrl = onboardingTextLink.startsWith("http")
        ? onboardingTextLink
        : `${base}${onboardingTextLink}`;
      setSnippetCopied(false);
      setSnippetCopyDelightId(0);
      let snippet: string;
      try {
        const manifest = await accessApi.getInviteOnboarding(invite.token);
        snippet = buildAgentSnippet({
          onboardingTextUrl: absoluteUrl,
          connectionCandidates:
            manifest.onboarding.connectivity?.connectionCandidates ?? null,
          testResolutionUrl:
            manifest.onboarding.connectivity?.testResolutionEndpoint?.url ??
            null
        });
      } catch {
        snippet = buildAgentSnippet({
          onboardingTextUrl: absoluteUrl,
          connectionCandidates: null,
          testResolutionUrl: null
        });
      }
      setInviteSnippet(snippet);
      try {
        await navigator.clipboard.writeText(snippet);
        setSnippetCopied(true);
        setSnippetCopyDelightId((prev) => prev + 1);
        setTimeout(() => setSnippetCopied(false), 2000);
      } catch {
        /* clipboard may not be available */
      }
      queryClient.invalidateQueries({
        queryKey: queryKeys.sidebarBadges(selectedCompanyId!)
      });
    },
    onError: (err) => {
      setInviteError(
        err instanceof Error ? err.message : "Failed to create invite"
      );
    }
  });

  const syncLogoState = (nextLogoUrl: string | null) => {
    setLogoUrl(nextLogoUrl ?? "");
    void queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
  };

  const logoUploadMutation = useMutation({
    mutationFn: (file: File) =>
      assetsApi
        .uploadCompanyLogo(selectedCompanyId!, file)
        .then((asset) => companiesApi.update(selectedCompanyId!, { logoAssetId: asset.assetId })),
    onSuccess: (company) => {
      syncLogoState(company.logoUrl);
      setLogoUploadError(null);
    }
  });

  const clearLogoMutation = useMutation({
    mutationFn: () => companiesApi.update(selectedCompanyId!, { logoAssetId: null }),
    onSuccess: (company) => {
      setLogoUploadError(null);
      syncLogoState(company.logoUrl);
    }
  });

  function handleLogoFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    event.currentTarget.value = "";
    if (!file) return;
    setLogoUploadError(null);
    logoUploadMutation.mutate(file);
  }

  function handleClearLogo() {
    clearLogoMutation.mutate();
  }

  useEffect(() => {
    setInviteError(null);
    setInviteSnippet(null);
    setSnippetCopied(false);
    setSnippetCopyDelightId(0);
  }, [selectedCompanyId]);

  const archiveMutation = useMutation({
    mutationFn: ({
      companyId,
      nextCompanyId
    }: {
      companyId: string;
      nextCompanyId: string | null;
    }) => companiesApi.archive(companyId).then(() => ({ nextCompanyId })),
    onSuccess: async ({ nextCompanyId }) => {
      if (nextCompanyId) {
        setSelectedCompanyId(nextCompanyId);
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.companies.all
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.companies.stats
      });
    }
  });

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/dashboard" },
      { label: "Settings" }
    ]);
  }, [setBreadcrumbs, selectedCompany?.name]);

  if (!selectedCompany) {
    return (
      <div className="text-sm text-muted-foreground">
        No company selected. Select a company from the switcher above.
      </div>
    );
  }

  function handleSaveGeneral() {
    generalMutation.mutate({
      name: companyName.trim(),
      description: description.trim() || null,
      brandColor: brandColor || null
    });
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-2">
        <Settings className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold">Company Settings</h1>
      </div>

      {/* General */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          General
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <Field label="Company name" hint="The display name for your company.">
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </Field>
          <Field
            label="Description"
            hint="Optional description shown in the company profile."
          >
            <input
              className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
              type="text"
              value={description}
              placeholder="Optional company description"
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>
        </div>
      </div>

      {/* Appearance */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Appearance
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <div className="flex items-start gap-4">
            <div className="shrink-0">
              <CompanyPatternIcon
                companyName={companyName || selectedCompany.name}
                logoUrl={logoUrl || null}
                brandColor={brandColor || null}
                className="rounded-[14px]"
              />
            </div>
            <div className="flex-1 space-y-3">
              <Field
                label="Logo"
                hint="Upload a PNG, JPEG, WEBP, GIF, or SVG logo image."
              >
                <div className="space-y-2">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    onChange={handleLogoFileChange}
                    className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none file:mr-4 file:rounded-md file:border-0 file:bg-muted file:px-2.5 file:py-1 file:text-xs"
                  />
                  {logoUrl && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleClearLogo}
                        disabled={clearLogoMutation.isPending}
                      >
                        {clearLogoMutation.isPending ? "Removing..." : "Remove logo"}
                      </Button>
                    </div>
                  )}
                  {(logoUploadMutation.isError || logoUploadError) && (
                    <span className="text-xs text-destructive">
                      {logoUploadError ??
                        (logoUploadMutation.error instanceof Error
                          ? logoUploadMutation.error.message
                          : "Logo upload failed")}
                    </span>
                  )}
                  {clearLogoMutation.isError && (
                    <span className="text-xs text-destructive">
                      {clearLogoMutation.error.message}
                    </span>
                  )}
                  {logoUploadMutation.isPending && (
                    <span className="text-xs text-muted-foreground">Uploading logo...</span>
                  )}
                </div>
              </Field>
              <Field
                label="Brand color"
                hint="Sets the hue for the company icon. Leave empty for auto-generated color."
              >
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={brandColor || "#6366f1"}
                    onChange={(e) => setBrandColor(e.target.value)}
                    className="h-8 w-8 cursor-pointer rounded border border-border bg-transparent p-0"
                  />
                  <input
                    type="text"
                    value={brandColor}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "" || /^#[0-9a-fA-F]{0,6}$/.test(v)) {
                        setBrandColor(v);
                      }
                    }}
                    placeholder="Auto"
                    className="w-28 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm font-mono outline-none"
                  />
                  {brandColor && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setBrandColor("")}
                      className="text-xs text-muted-foreground"
                    >
                      Clear
                    </Button>
                  )}
                </div>
              </Field>
            </div>
          </div>
        </div>
      </div>

      {/* Save button for General + Appearance */}
      {generalDirty && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleSaveGeneral}
            disabled={generalMutation.isPending || !companyName.trim()}
          >
            {generalMutation.isPending ? "Saving..." : "Save changes"}
          </Button>
          {generalMutation.isSuccess && (
            <span className="text-xs text-muted-foreground">Saved</span>
          )}
          {generalMutation.isError && (
            <span className="text-xs text-destructive">
              {generalMutation.error instanceof Error
                  ? generalMutation.error.message
                  : "Failed to save"}
            </span>
          )}
        </div>
      )}

      {/* Hiring */}
      <div className="space-y-4" data-testid="company-settings-team-section">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Hiring
        </div>
        <div className="rounded-md border border-border px-4 py-3">
          <ToggleField
            label="Require board approval for new hires"
            hint="New agent hires stay pending until approved by board."
            checked={!!selectedCompany.requireBoardApprovalForNewAgents}
            onChange={(v) => settingsMutation.mutate(v)}
            toggleTestId="company-settings-team-approval-toggle"
          />
        </div>
      </div>

      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Feedback Sharing
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <ToggleField
            label="Allow sharing voted AI outputs with Paperclip Labs"
            hint="Only AI-generated outputs you explicitly vote on are eligible for feedback sharing."
            checked={!!selectedCompany.feedbackDataSharingEnabled}
            onChange={(enabled) => feedbackSharingMutation.mutate(enabled)}
          />
          <p className="text-sm text-muted-foreground">
            Votes are always saved locally. This setting controls whether voted AI outputs may also be marked for sharing with Paperclip Labs.
          </p>
          <div className="space-y-1 text-xs text-muted-foreground">
            <div>
              Terms version: {selectedCompany.feedbackDataSharingTermsVersion ?? DEFAULT_FEEDBACK_DATA_SHARING_TERMS_VERSION}
            </div>
            {selectedCompany.feedbackDataSharingConsentAt ? (
              <div>
                Enabled {new Date(selectedCompany.feedbackDataSharingConsentAt).toLocaleString()}
                {selectedCompany.feedbackDataSharingConsentByUserId
                  ? ` by ${selectedCompany.feedbackDataSharingConsentByUserId}`
                  : ""}
              </div>
            ) : (
              <div>Sharing is currently disabled.</div>
            )}
            {FEEDBACK_TERMS_URL ? (
              <a
                href={FEEDBACK_TERMS_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex text-foreground underline underline-offset-4"
              >
                Read our terms of service
              </a>
            ) : null}
          </div>
        </div>
      </div>

      {/* Invites */}
      <div className="space-y-4" data-testid="company-settings-invites-section">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Invites
        </div>
        <div className="space-y-3 rounded-md border border-border px-4 py-4">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">
              Generate an OpenClaw agent invite snippet.
            </span>
            <HintIcon text="Creates a short-lived OpenClaw agent invite and renders a copy-ready prompt." />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              data-testid="company-settings-invites-generate-button"
              size="sm"
              onClick={() => inviteMutation.mutate()}
              disabled={inviteMutation.isPending}
            >
              {inviteMutation.isPending
                ? "Generating..."
                : "Generate OpenClaw Invite Prompt"}
            </Button>
          </div>
          {inviteError && (
            <p className="text-sm text-destructive">{inviteError}</p>
          )}
          {inviteSnippet && (
            <div
              className="rounded-md border border-border bg-muted/30 p-2"
              data-testid="company-settings-invites-snippet"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs text-muted-foreground">
                  OpenClaw Invite Prompt
                </div>
                {snippetCopied && (
                  <span
                    key={snippetCopyDelightId}
                    className="flex items-center gap-1 text-xs text-green-600 animate-pulse"
                  >
                    <Check className="h-3 w-3" />
                    Copied
                  </span>
                )}
              </div>
              <div className="mt-1 space-y-1.5">
                <textarea
                  data-testid="company-settings-invites-snippet-textarea"
                  className="h-[28rem] w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none"
                  value={inviteSnippet}
                  readOnly
                />
                <div className="flex justify-end">
                  <Button
                    data-testid="company-settings-invites-copy-button"
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(inviteSnippet);
                        setSnippetCopied(true);
                        setSnippetCopyDelightId((prev) => prev + 1);
                        setTimeout(() => setSnippetCopied(false), 2000);
                      } catch {
                        /* clipboard may not be available */
                      }
                    }}
                  >
                    {snippetCopied ? "Copied snippet" : "Copy snippet"}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Secrets */}
      <SecretsSection companyId={selectedCompanyId!} />

      {/* Kanban Board */}
      <KanbanBoardSection
        companyId={selectedCompanyId!}
        initialConfig={selectedCompany.kanbanConfig}
        kanbanGitUrl={selectedCompany.kanbanGitUrl}
        kanbanLastSyncedAt={selectedCompany.kanbanLastSyncedAt}
        kanbanLastSyncError={selectedCompany.kanbanLastSyncError}
        kanbanGitSha={selectedCompany.kanbanGitSha}
      />

      {/* Import / Export */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Company Packages
        </div>
        <div className="rounded-md border border-border px-4 py-4">
          <p className="text-sm text-muted-foreground">
            Import and export have moved to dedicated pages accessible from the{" "}
            <a href="/org" className="underline hover:text-foreground">Org Chart</a> header.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <Button size="sm" variant="outline" asChild>
              <a href="/company/export">
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Export
              </a>
            </Button>
            <Button size="sm" variant="outline" asChild>
              <a href="/company/import">
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                Import
              </a>
            </Button>
          </div>
        </div>
      </div>

      {/* Danger Zone */}
      <div className="space-y-4">
        <div className="text-xs font-medium text-destructive uppercase tracking-wide">
          Danger Zone
        </div>
        <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 px-4 py-4">
          <p className="text-sm text-muted-foreground">
            Archive this company to hide it from the sidebar. This persists in
            the database.
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={
                archiveMutation.isPending ||
                selectedCompany.status === "archived"
              }
              onClick={() => {
                if (!selectedCompanyId) return;
                const confirmed = window.confirm(
                  `Archive company "${selectedCompany.name}"? It will be hidden from the sidebar.`
                );
                if (!confirmed) return;
                const nextCompanyId =
                  companies.find(
                    (company) =>
                      company.id !== selectedCompanyId &&
                      company.status !== "archived"
                  )?.id ?? null;
                archiveMutation.mutate({
                  companyId: selectedCompanyId,
                  nextCompanyId
                });
              }}
            >
              {archiveMutation.isPending
                ? "Archiving..."
                : selectedCompany.status === "archived"
                ? "Already archived"
                : "Archive company"}
            </Button>
            {archiveMutation.isError && (
              <span className="text-xs text-destructive">
                {archiveMutation.error instanceof Error
                  ? archiveMutation.error.message
                  : "Failed to archive company"}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SecretsSection({ companyId }: { companyId: string }) {
  const queryClient = useQueryClient();
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [showNewValue, setShowNewValue] = useState(false);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [rotateValue, setRotateValue] = useState("");
  const [showRotateValue, setShowRotateValue] = useState(false);

  const { data: secrets = [], isLoading } = useQuery({
    queryKey: queryKeys.secrets.list(companyId),
    queryFn: () => secretsApi.list(companyId),
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; value: string; description?: string }) =>
      secretsApi.create(companyId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.list(companyId) });
      setShowAddForm(false);
      setNewName("");
      setNewValue("");
      setNewDescription("");
      setShowNewValue(false);
    },
  });

  const rotateMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: string }) =>
      secretsApi.rotate(id, { value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.list(companyId) });
      setRotatingId(null);
      setRotateValue("");
      setShowRotateValue(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => secretsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.secrets.list(companyId) });
    },
  });

  function handleCreate() {
    if (!newName.trim() || !newValue.trim()) return;
    createMutation.mutate({
      name: newName.trim(),
      value: newValue,
      description: newDescription.trim() || undefined,
    });
  }

  function handleRotate(secret: CompanySecret) {
    if (!rotateValue.trim()) return;
    rotateMutation.mutate({ id: secret.id, value: rotateValue });
  }

  function handleDelete(secret: CompanySecret) {
    if (!window.confirm(`Delete secret "${secret.name}"? This cannot be undone.`)) return;
    deleteMutation.mutate(secret.id);
  }

  return (
    <div className="space-y-4">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Secrets
      </div>
      <div className="space-y-2 rounded-md border border-border px-4 py-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Encrypted key/value secrets agents can retrieve at runtime.
            </span>
            <HintIcon text="Agents can list secrets by name and retrieve values via the Paperclip API. Values are never shown in the UI." />
          </div>
          {!showAddForm && (
            <Button size="sm" variant="ghost" onClick={() => setShowAddForm(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add secret
            </Button>
          )}
        </div>

        {showAddForm && (
          <div className="mt-3 space-y-2 rounded-md border border-border bg-muted/20 px-3 py-3">
            <div className="text-xs font-medium">New secret</div>
            <Field label="Name" hint="A unique identifier, e.g. sonarr-api-key">
              <input
                className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm font-mono outline-none"
                type="text"
                placeholder="e.g. sonarr-api-key"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
            </Field>
            <Field label="Value" hint="The secret value — stored encrypted, never shown again.">
              <div className="flex items-center gap-1.5">
                <input
                  className="flex-1 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm font-mono outline-none"
                  type={showNewValue ? "text" : "password"}
                  placeholder="Secret value"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowNewValue((v) => !v)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {showNewValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>
            <Field label="Description" hint="Optional — helps agents identify which secret to use.">
              <input
                className="w-full rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm outline-none"
                type="text"
                placeholder="e.g. Sonarr API key for TV show automation"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
              />
            </Field>
            <div className="flex items-center gap-2 pt-1">
              <Button
                size="sm"
                onClick={handleCreate}
                disabled={createMutation.isPending || !newName.trim() || !newValue.trim()}
              >
                {createMutation.isPending ? "Saving..." : "Save secret"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setShowAddForm(false);
                  setNewName("");
                  setNewValue("");
                  setNewDescription("");
                  setShowNewValue(false);
                  createMutation.reset();
                }}
              >
                Cancel
              </Button>
              {createMutation.isError && (
                <span className="text-xs text-destructive">
                  {createMutation.error instanceof Error
                    ? createMutation.error.message
                    : "Failed to save"}
                </span>
              )}
            </div>
          </div>
        )}

        {isLoading && (
          <div className="py-4 text-center text-xs text-muted-foreground">Loading secrets…</div>
        )}

        {!isLoading && secrets.length === 0 && !showAddForm && (
          <div className="py-4 text-center text-xs text-muted-foreground">
            No secrets yet. Add one to let agents access credentials at runtime.
          </div>
        )}

        {secrets.length > 0 && (
          <div className="mt-2 divide-y divide-border rounded-md border border-border">
            {secrets.map((secret) => (
              <div key={secret.id} className="px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium">{secret.name}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        v{secret.latestVersion}
                      </span>
                      {secret.provider !== "local_encrypted" && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {secret.provider}
                        </span>
                      )}
                    </div>
                    {secret.description && (
                      <div className="mt-0.5 text-xs text-muted-foreground">{secret.description}</div>
                    )}
                    <div className="mt-0.5 font-mono text-xs text-muted-foreground tracking-widest">
                      ••••••••••••
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        setRotatingId(rotatingId === secret.id ? null : secret.id);
                        setRotateValue("");
                        setShowRotateValue(false);
                        rotateMutation.reset();
                      }}
                      title="Rotate secret"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                      onClick={() => handleDelete(secret)}
                      disabled={deleteMutation.isPending}
                      title="Delete secret"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {rotatingId === secret.id && (
                  <div className="mt-2 space-y-2 rounded-md border border-border bg-muted/20 px-3 py-2">
                    <div className="text-xs font-medium">New value for <span className="font-mono">{secret.name}</span></div>
                    <div className="flex items-center gap-1.5">
                      <input
                        className="flex-1 rounded-md border border-border bg-transparent px-2.5 py-1.5 text-sm font-mono outline-none"
                        type={showRotateValue ? "text" : "password"}
                        placeholder="New secret value"
                        value={rotateValue}
                        onChange={(e) => setRotateValue(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => setShowRotateValue((v) => !v)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        {showRotateValue ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleRotate(secret)}
                        disabled={rotateMutation.isPending || !rotateValue.trim()}
                      >
                        {rotateMutation.isPending ? "Rotating..." : "Rotate"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setRotatingId(null);
                          setRotateValue("");
                          setShowRotateValue(false);
                        }}
                      >
                        Cancel
                      </Button>
                      {rotateMutation.isError && (
                        <span className="text-xs text-destructive">
                          {rotateMutation.error instanceof Error
                            ? rotateMutation.error.message
                            : "Rotation failed"}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function KanbanBoardSection({
  companyId,
  initialConfig,
  kanbanGitUrl,
  kanbanLastSyncedAt,
  kanbanLastSyncError,
  kanbanGitSha,
}: {
  companyId: string;
  initialConfig: KanbanConfig | null;
  kanbanGitUrl: string | null;
  kanbanLastSyncedAt: Date | null | string;
  kanbanLastSyncError: string | null;
  kanbanGitSha: string | null;
}) {
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const [gitUrlDraft, setGitUrlDraft] = useState("");
  const [isEditingGitUrl, setIsEditingGitUrl] = useState(false);
  const [syncResult, setSyncResult] = useState<{ ok: boolean; sha?: string; columnsCount?: number; rulesCount?: number; error?: string } | null>(null);

  const isGitManaged = !!kanbanGitUrl;

  const { data: gitStatus } = useQuery({
    queryKey: ["kanban-git-status", companyId],
    queryFn: () => companiesApi.checkKanbanGitStatus(companyId),
    enabled: isGitManaged,
    staleTime: 60_000,
  });

  const saveGitUrl = useMutation({
    mutationFn: (url: string | null) => companiesApi.update(companyId, { kanbanGitUrl: url }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      queryClient.invalidateQueries({ queryKey: ["kanban-git-status", companyId] });
      setIsEditingGitUrl(false);
      setGitUrlDraft("");
      setSyncResult(null);
    },
    onError: (err) => {
      pushToast({ title: "Failed to save git URL", body: err instanceof Error ? err.message : "Unknown error", tone: "error" });
    },
  });

  const sync = useMutation({
    mutationFn: () => companiesApi.syncKanbanConfig(companyId),
    onSuccess: (data) => {
      setSyncResult(data);
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      queryClient.invalidateQueries({ queryKey: ["kanban-git-status", companyId] });
    },
    onError: (err) => {
      setSyncResult({ ok: false, error: err instanceof Error ? err.message : "Sync failed" });
    },
  });

  const kanbanMutation = useMutation({
    mutationFn: (config: KanbanConfig | null) =>
      companiesApi.updateKanbanConfig(companyId, config),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
    },
    onError: (err) => {
      const body = (err as { body?: { error?: string; details?: unknown } }).body;
      const detail = body?.details ? ` (${JSON.stringify(body.details)})` : "";
      const message = (err instanceof Error ? err.message : "Unknown error") + detail;
      pushToast({ title: "Failed to save kanban config", body: message, tone: "error" });
    },
  });

  return (
    <div className="space-y-4">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        Kanban Board
      </div>
      <div className="rounded-md border border-border px-4 py-4">
        <p className="text-xs text-muted-foreground mb-4">
          Configure columns, WIP limits, and transition rules for this company's board.
          Start from a template or build your own.
        </p>

        {/* Git URL section */}
        <div className="mb-4 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Git Sync</p>
          <p className="text-xs text-muted-foreground">
            Optionally reference a raw JSON file URL to manage this company's kanban config from git.
          </p>

          {kanbanGitUrl && !isEditingGitUrl ? (
            <div className="flex items-center gap-2">
              <div className={cn(
                "flex flex-1 items-center gap-1.5 rounded border px-2 py-1.5 text-xs font-mono bg-muted/40 min-w-0 overflow-hidden",
                (() => {
                  if (kanbanLastSyncError || gitStatus?.fetchError) return "border-destructive/50";
                  if (gitStatus && !gitStatus.inSync) return "border-yellow-500/50";
                  if (gitStatus?.inSync) return "border-green-500/50";
                  return "";
                })()
              )}>
                <span className={cn(
                  "inline-block h-2 w-2 shrink-0 rounded-full",
                  (() => {
                    if (kanbanLastSyncError || gitStatus?.fetchError) return "bg-destructive";
                    if (gitStatus && !gitStatus.inSync) return "bg-yellow-500";
                    if (gitStatus?.inSync) return "bg-green-500";
                    return "bg-muted-foreground";
                  })()
                )} />
                <span className="truncate text-muted-foreground">{kanbanGitUrl}</span>
                {(kanbanGitSha ?? gitStatus?.localSha) && (
                  <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px]">
                    {(kanbanGitSha ?? gitStatus?.localSha ?? "").slice(0, 8)}
                  </span>
                )}
              </div>
              <Button
                size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0"
                title="Remove git URL"
                onClick={() => saveGitUrl.mutate(null)}
                disabled={saveGitUrl.isPending}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm" variant="outline" className="h-7 px-2 text-xs shrink-0"
                onClick={() => { setSyncResult(null); sync.mutate(); }}
                disabled={sync.isPending}
              >
                {sync.isPending ? (
                  <><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />Syncing…</>
                ) : "Sync Now"}
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <input
                className="flex-1 rounded border border-border bg-transparent px-2.5 py-1.5 text-xs font-mono outline-none focus:border-ring"
                placeholder="https://raw.githubusercontent.com/org/repo/main/kanban.json"
                value={isEditingGitUrl ? gitUrlDraft : ""}
                onFocus={() => { setIsEditingGitUrl(true); }}
                onChange={(e) => setGitUrlDraft(e.target.value)}
              />
              {isEditingGitUrl && (
                <>
                  <Button size="sm" variant="ghost" className="h-7 text-xs"
                    onClick={() => { setIsEditingGitUrl(false); setGitUrlDraft(""); }}
                    disabled={saveGitUrl.isPending}
                  >Cancel</Button>
                  <Button size="sm" className="h-7 text-xs"
                    onClick={() => saveGitUrl.mutate(gitUrlDraft)}
                    disabled={saveGitUrl.isPending || !gitUrlDraft.trim()}
                  >
                    {saveGitUrl.isPending ? "Saving…" : "Save"}
                  </Button>
                </>
              )}
            </div>
          )}

          {(kanbanLastSyncedAt || kanbanLastSyncError || syncResult) && (
            <p className="text-xs text-muted-foreground">
              {syncResult ? (
                syncResult.ok ? (
                  <span className="text-green-600 dark:text-green-400">
                    Synced {syncResult.columnsCount} columns, {syncResult.rulesCount} rules
                    {syncResult.sha ? ` (${syncResult.sha.slice(0, 8)})` : ""}
                  </span>
                ) : (
                  <span className="text-destructive">Sync failed: {syncResult.error}</span>
                )
              ) : kanbanLastSyncError ? (
                <span className="text-destructive">Last sync failed: {kanbanLastSyncError}</span>
              ) : kanbanLastSyncedAt ? (
                <>Last synced: {new Date(kanbanLastSyncedAt).toLocaleString()}
                  {gitStatus && !gitStatus.inSync && !gitStatus.fetchError && (
                    <span className="ml-1 text-yellow-600 dark:text-yellow-400">· update available</span>
                  )}
                </>
              ) : null}
            </p>
          )}
        </div>

        <KanbanConfigEditor
          companyId={companyId}
          initialConfig={initialConfig}
          onSave={(config) => kanbanMutation.mutate(config)}
          isSaving={kanbanMutation.isPending}
          readOnly={isGitManaged}
        />
        {kanbanMutation.isSuccess && (
          <p className="mt-2 text-xs text-muted-foreground">Board config saved.</p>
        )}
        {kanbanMutation.isError && (
          <p className="mt-2 text-xs text-destructive">
            {kanbanMutation.error instanceof Error
              ? kanbanMutation.error.message
              : "Failed to save board config"}
          </p>
        )}
      </div>
    </div>
  );
}

function buildAgentSnippet(input: AgentSnippetInput) {
  const candidateUrls = buildCandidateOnboardingUrls(input);
  const resolutionTestUrl = buildResolutionTestUrl(input);

  const candidateList =
    candidateUrls.length > 0
      ? candidateUrls.map((u) => `- ${u}`).join("\n")
      : "- (No candidate URLs available yet.)";

  const connectivityBlock =
    candidateUrls.length === 0
      ? `No candidate URLs are available. Ask your user to configure a reachable hostname in Paperclip, then retry.
Suggested steps:
- choose a hostname that resolves to the Paperclip host from your runtime
- run: pnpm paperclipai allowed-hostname <host>
- restart Paperclip
- verify with: curl -fsS http://<host>:3100/api/health
- regenerate this invite snippet`
      : `If none are reachable, ask your user to add a reachable hostname in Paperclip, restart, and retry.
Suggested command:
- pnpm paperclipai allowed-hostname <host>
Then verify with: curl -fsS <base-url>/api/health`;

  const resolutionLine = resolutionTestUrl
    ? `\nYou MUST test Paperclip-to-gateway reachability, call: ${resolutionTestUrl}?url=<urlencoded-gateway-url> (using the hostname that worked above). Do not assume your 172.x is necessarily reachable from Paperclip. Test it. `
    : "";

  return `You're invited to join a Paperclip organization.

The URLs you should try are:
${candidateList}

Connectivity guidance:
If you are running on a different machine than Paperclip, Paperclip must be reachable at one of the hostnames used above.
Verify the hostname works from your runtime with: GET <base-url>/api/health

${connectivityBlock}

For your "agentName", just use your own agent name (OpenClaw or whatever your name is) and send it directly.
You also need to send a gateway URL that Paperclip can access. Check your config and include that URL.${resolutionLine}

---

This onboarding flow is for OpenClaw Gateway.
When you submit the join request, use:
- \`adapterType: "openclaw_gateway"\`
- \`agentDefaultsPayload.url\` as your \`ws://\` or \`wss://\` gateway URL
- \`agentDefaultsPayload.headers["x-openclaw-token"]\` with your gateway token
- (legacy accepted) \`agentDefaultsPayload.headers["x-openclaw-auth"]\`
- Keep device auth enabled (recommended). If \`devicePrivateKeyPem\` is omitted, Paperclip will generate and persist one during join so pairing approvals remain stable.
- Only use \`disableDeviceAuth=true\` for special environments where pairing cannot be completed.

Do NOT use \`/v1/responses\` or \`/hooks/*\` in this join flow.

Before you do anything, please respond to your user that you understand the instructions and you're going to work on them. Then do the step above in another session called "paperclip-onboarding" and then tell your user when you're done. Update your user in intermediate steps along the way so they know what's going on.

Then after you've connected to Paperclip (exchanged keys etc.) you MUST review and follow the onboarding instructions in onboarding.txt they give you.

`;
}

function buildCandidateOnboardingUrls(input: AgentSnippetInput): string[] {
  const candidates = (input.connectionCandidates ?? [])
    .map((candidate) => candidate.trim())
    .filter(Boolean);
  const urls = new Set<string>();
  let onboardingUrl: URL | null = null;

  try {
    onboardingUrl = new URL(input.onboardingTextUrl);
    urls.add(onboardingUrl.toString());
  } catch {
    const trimmed = input.onboardingTextUrl.trim();
    if (trimmed) {
      urls.add(trimmed);
    }
  }

  if (!onboardingUrl) {
    for (const candidate of candidates) {
      urls.add(candidate);
    }
    return Array.from(urls);
  }

  const onboardingPath = `${onboardingUrl.pathname}${onboardingUrl.search}`;
  for (const candidate of candidates) {
    try {
      const base = new URL(candidate);
      urls.add(`${base.origin}${onboardingPath}`);
    } catch {
      urls.add(candidate);
    }
  }

  return Array.from(urls);
}

function buildResolutionTestUrl(input: AgentSnippetInput): string | null {
  const explicit = input.testResolutionUrl?.trim();
  if (explicit) return explicit;

  try {
    const onboardingUrl = new URL(input.onboardingTextUrl);
    const testPath = onboardingUrl.pathname.replace(
      /\/onboarding\.txt$/,
      "/test-resolution"
    );
    return `${onboardingUrl.origin}${testPath}`;
  } catch {
    return null;
  }
}
