import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plug, Plus, Star, Trash2 } from "lucide-react";
import type { InstanceMcpCatalogEntry, InstanceMcpServerAgent, InstanceMcpServerEntry } from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { heartbeatsApi } from "../api/heartbeats";
import { agentsApi } from "../api/agents";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { queryKeys } from "../lib/queryKeys";

function agentHref(agent: InstanceMcpServerAgent) {
  return `/${agent.companyIssuePrefix}/agents/${encodeURIComponent(agent.agentUrlKey)}`;
}

function mcpTypeBadge(config: Record<string, unknown>) {
  const type = typeof config.type === "string" ? config.type : "stdio";
  return (
    <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
      {type}
    </Badge>
  );
}

function mcpConfigSummary(config: Record<string, unknown>) {
  if (config.type === "http" && typeof config.url === "string") {
    return config.url;
  }
  if (typeof config.command === "string") {
    const args = Array.isArray(config.args) ? ` ${(config.args as string[]).join(" ")}` : "";
    return `${config.command}${args}`;
  }
  return null;
}

// ── Catalog Section ──────────────────────────────────────────────────────────

interface AddCatalogEntryFormProps {
  onAdd: (entry: { name: string; config: Record<string, unknown>; isDefault: boolean }) => void;
  isPending: boolean;
}

function AddCatalogEntryForm({ onAdd, isPending }: AddCatalogEntryFormProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"http" | "stdio">("http");
  const [url, setUrl] = useState("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const config: Record<string, unknown> =
      type === "http"
        ? { type: "http", url }
        : {
            type: "stdio",
            command,
            ...(args.trim() ? { args: args.trim().split(/\s+/) } : {}),
          };
    onAdd({ name: name.trim(), config, isDefault });
    setName("");
    setUrl("");
    setCommand("");
    setArgs("");
    setIsDefault(false);
  }

  const isValid = name.trim() && (type === "http" ? url.trim() : command.trim());

  return (
    <form onSubmit={handleSubmit} className="p-3 border-t space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Name</Label>
          <Input
            className="h-7 text-xs"
            placeholder="e.g. muninndb"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Type</Label>
          <select
            className="w-full h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            value={type}
            onChange={(e) => setType(e.target.value as "http" | "stdio")}
          >
            <option value="http">http</option>
            <option value="stdio">stdio</option>
          </select>
        </div>
      </div>

      {type === "http" ? (
        <div className="space-y-1">
          <Label className="text-xs">URL</Label>
          <Input
            className="h-7 text-xs font-mono"
            placeholder="http://127.0.0.1:8750/mcp"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Command</Label>
            <Input
              className="h-7 text-xs font-mono"
              placeholder="python"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Args (space-separated)</Label>
            <Input
              className="h-7 text-xs font-mono"
              placeholder="-m mcp_server"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Checkbox
            id="catalog-is-default"
            checked={isDefault}
            onCheckedChange={(v) => setIsDefault(Boolean(v))}
          />
          <Label htmlFor="catalog-is-default" className="text-xs cursor-pointer">
            Default (auto-attach to new agents)
          </Label>
        </div>
        <Button size="sm" className="h-7 px-2 text-xs" disabled={!isValid || isPending} type="submit">
          <Plus className="h-3.5 w-3.5 mr-1" />
          {isPending ? "Adding…" : "Add"}
        </Button>
      </div>
    </form>
  );
}

interface CatalogEntryRowProps {
  entry: InstanceMcpCatalogEntry;
}

function CatalogEntryRow({ entry }: CatalogEntryRowProps) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const toggleDefaultMutation = useMutation({
    mutationFn: (isDefault: boolean) =>
      heartbeatsApi.updateMcpCatalogEntry(entry.id, { isDefault }),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.instance.mcpCatalog });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Update failed"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => heartbeatsApi.deleteMcpCatalogEntry(entry.id),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.instance.mcpCatalog });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Delete failed"),
  });

  const config = entry.config as Record<string, unknown>;
  const summary = mcpConfigSummary(config);
  const isMutating = toggleDefaultMutation.isPending || deleteMutation.isPending;

  return (
    <div className="border-b last:border-b-0">
      <div className="flex items-center gap-2 px-3 py-2">
        {mcpTypeBadge(config)}
        <span className="font-medium text-sm">{entry.name}</span>
        {summary && (
          <span className="text-xs text-muted-foreground font-mono truncate">{summary}</span>
        )}
        <span className="ml-auto flex items-center gap-3 shrink-0">
          <label className="flex items-center gap-1.5 cursor-pointer" title="Auto-attach to new agents">
            <Checkbox
              checked={entry.isDefault}
              disabled={isMutating}
              onCheckedChange={(v) => toggleDefaultMutation.mutate(Boolean(v))}
            />
            <span className="text-xs text-muted-foreground">default</span>
          </label>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
            disabled={isMutating}
            title="Remove from catalog"
            onClick={() => deleteMutation.mutate()}
          >
            {deleteMutation.isPending ? "…" : <Trash2 className="h-3.5 w-3.5" />}
          </Button>
        </span>
      </div>
      {error && (
        <div className="px-3 py-1 text-xs text-destructive bg-destructive/5">{error}</div>
      )}
    </div>
  );
}

interface CatalogSectionProps {
  defaultCount: number;
}

function CatalogSection({ defaultCount }: CatalogSectionProps) {
  const queryClient = useQueryClient();
  const [applyResult, setApplyResult] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const catalogQuery = useQuery({
    queryKey: queryKeys.instance.mcpCatalog,
    queryFn: () => heartbeatsApi.listMcpCatalog(),
    refetchInterval: 30_000,
  });

  const addMutation = useMutation({
    mutationFn: (data: { name: string; config: Record<string, unknown>; isDefault: boolean }) =>
      heartbeatsApi.createMcpCatalogEntry(data),
    onSuccess: () => {
      setAddError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.instance.mcpCatalog });
    },
    onError: (err) => setAddError(err instanceof Error ? err.message : "Failed to add entry"),
  });

  const applyMutation = useMutation({
    mutationFn: () => heartbeatsApi.applyMcpCatalogDefaults(),
    onSuccess: (data) => {
      setApplyResult(`Applied to ${data.updatedAgents} agent${data.updatedAgents !== 1 ? "s" : ""}`);
      queryClient.invalidateQueries({ queryKey: queryKeys.instance.mcpServers });
    },
    onError: (err) => setApplyResult(err instanceof Error ? err.message : "Apply failed"),
  });

  const entries = catalogQuery.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">MCP Catalog</h2>
            {defaultCount > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {defaultCount} default{defaultCount !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Instance-level MCP registry. Entries marked as default are auto-attached to new agents.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {applyResult && (
            <span className="text-xs text-muted-foreground">{applyResult}</span>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            disabled={defaultCount === 0 || applyMutation.isPending}
            onClick={() => {
              setApplyResult(null);
              applyMutation.mutate();
            }}
            title="Apply all default MCPs to existing agents that are missing them"
          >
            {applyMutation.isPending ? "Applying…" : "Apply defaults to all agents"}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {catalogQuery.isLoading ? (
            <div className="px-3 py-4 text-xs text-muted-foreground">Loading catalog…</div>
          ) : entries.length === 0 ? (
            <div className="px-3 py-4 text-xs text-muted-foreground">
              No catalog entries yet. Add one below.
            </div>
          ) : (
            <div className="divide-y">
              {entries.map((entry) => (
                <CatalogEntryRow key={entry.id} entry={entry} />
              ))}
            </div>
          )}

          {addError && (
            <div className="px-3 py-1.5 text-xs text-destructive border-t border-destructive/20 bg-destructive/5">
              {addError}
            </div>
          )}

          <AddCatalogEntryForm
            onAdd={(data) => addMutation.mutate(data)}
            isPending={addMutation.isPending}
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ── Agent MCP Assignments ────────────────────────────────────────────────────

interface AssignPanelProps {
  mcp: InstanceMcpServerEntry;
  allAgents: InstanceMcpServerAgent[];
  onAssign: (agentId: string, companyId: string) => void;
  isPending: boolean;
}

function AssignPanel({ mcp, allAgents, onAssign, isPending }: AssignPanelProps) {
  const [selectedAgentId, setSelectedAgentId] = useState("");

  const assignedIds = useMemo(() => new Set(mcp.assignedAgents.map((a) => a.id)), [mcp.assignedAgents]);
  const unassigned = useMemo(
    () => allAgents.filter((a) => !assignedIds.has(a.id)),
    [allAgents, assignedIds],
  );

  if (unassigned.length === 0) return null;

  const selectedAgent = unassigned.find((a) => a.id === selectedAgentId);

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-t">
      <select
        className="flex-1 h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        value={selectedAgentId}
        onChange={(e) => setSelectedAgentId(e.target.value)}
      >
        <option value="">Assign to agent…</option>
        {unassigned.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.companyName} › {agent.agentName}
          </option>
        ))}
      </select>
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs shrink-0"
        disabled={!selectedAgent || isPending}
        onClick={() => {
          if (selectedAgent) {
            onAssign(selectedAgent.id, selectedAgent.companyId);
            setSelectedAgentId("");
          }
        }}
      >
        {isPending ? "…" : "Assign"}
      </Button>
    </div>
  );
}

interface McpCardProps {
  mcp: InstanceMcpServerEntry;
  allAgents: InstanceMcpServerAgent[];
}

function McpCard({ mcp, allAgents }: McpCardProps) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const unassignMutation = useMutation({
    mutationFn: async ({ agentId, companyId }: { agentId: string; companyId: string }) => {
      const agent = await agentsApi.get(agentId, companyId);
      const current = (agent.mcpServers ?? {}) as Record<string, unknown>;
      const remaining = Object.fromEntries(
        Object.entries(current).filter(([key]) => key !== mcp.name),
      );
      return agentsApi.update(agentId, { mcpServers: remaining }, companyId);
    },
    onSuccess: async (_, { agentId, companyId }) => {
      setActionError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.instance.mcpServers }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agentId) }),
      ]);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to remove MCP.");
    },
  });

  const assignMutation = useMutation({
    mutationFn: async ({ agentId, companyId }: { agentId: string; companyId: string }) => {
      const agent = await agentsApi.get(agentId, companyId);
      const current = (agent.mcpServers ?? {}) as Record<string, unknown>;
      return agentsApi.update(agentId, { mcpServers: { ...current, [mcp.name]: mcp.config } }, companyId);
    },
    onSuccess: async (_, { agentId, companyId }) => {
      setActionError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.instance.mcpServers }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.list(companyId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.agents.detail(agentId) }),
      ]);
    },
    onError: (err) => {
      setActionError(err instanceof Error ? err.message : "Failed to assign MCP.");
    },
  });

  const summary = mcpConfigSummary(mcp.config);
  const isMutating = unassignMutation.isPending || assignMutation.isPending;

  return (
    <Card>
      <CardContent className="p-0">
        {/* MCP header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b">
          {mcpTypeBadge(mcp.config)}
          <span className="font-medium text-sm">{mcp.name}</span>
          {summary && (
            <span className="text-xs text-muted-foreground font-mono truncate">{summary}</span>
          )}
          <span className="ml-auto text-xs text-muted-foreground shrink-0">
            {mcp.assignedAgents.length} {mcp.assignedAgents.length === 1 ? "agent" : "agents"}
          </span>
        </div>

        {actionError && (
          <div className="px-3 py-1.5 text-xs text-destructive border-b border-destructive/20 bg-destructive/5">
            {actionError}
          </div>
        )}

        {/* Assigned agents */}
        {mcp.assignedAgents.length > 0 && (
          <div className="divide-y">
            {mcp.assignedAgents.map((agent) => {
              const removing =
                unassignMutation.isPending &&
                unassignMutation.variables?.agentId === agent.id;
              return (
                <div key={agent.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <span className="text-xs text-muted-foreground shrink-0">{agent.companyName}</span>
                  <span className="text-muted-foreground shrink-0">›</span>
                  <Link
                    to={agentHref(agent)}
                    className="font-medium truncate hover:underline"
                  >
                    {agent.agentName}
                  </Link>
                  <span className="hidden sm:inline text-xs text-muted-foreground truncate">
                    {agent.title ?? agent.role}
                  </span>
                  <span className="ml-auto flex items-center gap-1.5 shrink-0">
                    <Link
                      to={agentHref(agent)}
                      className="text-muted-foreground hover:text-foreground"
                      title="Agent config"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      disabled={isMutating}
                      title="Remove MCP from this agent"
                      onClick={() =>
                        unassignMutation.mutate({ agentId: agent.id, companyId: agent.companyId })
                      }
                    >
                      {removing ? "…" : <Trash2 className="h-3.5 w-3.5" />}
                    </Button>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Assign to another agent */}
        <AssignPanel
          mcp={mcp}
          allAgents={allAgents}
          isPending={assignMutation.isPending}
          onAssign={(agentId, companyId) => assignMutation.mutate({ agentId, companyId })}
        />
      </CardContent>
    </Card>
  );
}

export function InstanceMcps() {
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([
      { label: "Instance Settings" },
      { label: "MCPs" },
    ]);
  }, [setBreadcrumbs]);

  const mcpQuery = useQuery({
    queryKey: queryKeys.instance.mcpServers,
    queryFn: () => heartbeatsApi.listInstanceMcpServers(),
    refetchInterval: 30_000,
  });

  const catalogQuery = useQuery({
    queryKey: queryKeys.instance.mcpCatalog,
    queryFn: () => heartbeatsApi.listMcpCatalog(),
    refetchInterval: 30_000,
  });

  const data = mcpQuery.data;
  const mcpServers = data?.mcpServers ?? [];
  const allAgents = data?.allAgents ?? [];
  const catalogEntries = catalogQuery.data ?? [];
  const defaultCount = catalogEntries.filter((e) => e.isDefault).length;

  const totalAssignments = useMemo(
    () => mcpServers.reduce((sum, m) => sum + m.assignedAgents.length, 0),
    [mcpServers],
  );
  const companyCount = useMemo(
    () => new Set(allAgents.map((a) => a.companyId)).size,
    [allAgents],
  );

  if (mcpQuery.isLoading) {
    return <div className="text-sm text-muted-foreground">Loading MCP servers…</div>;
  }

  if (mcpQuery.error) {
    return (
      <div className="text-sm text-destructive">
        {mcpQuery.error instanceof Error ? mcpQuery.error.message : "Failed to load MCP servers."}
      </div>
    );
  }

  return (
    <div className="max-w-5xl space-y-8">
      {/* Catalog section */}
      <CatalogSection defaultCount={defaultCount} />

      {/* Agent assignments section */}
      <div className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Plug className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold">MCP Servers</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            MCP servers configured across agents in your companies. Assign or remove servers per agent.
          </p>
        </div>

        <div className="flex gap-4 text-sm text-muted-foreground">
          <span>
            <span className="font-semibold text-foreground">{mcpServers.length}</span> servers
          </span>
          <span>
            <span className="font-semibold text-foreground">{totalAssignments}</span> assignments
          </span>
          <span>
            <span className="font-semibold text-foreground">{companyCount}</span>{" "}
            {companyCount === 1 ? "company" : "companies"}
          </span>
        </div>

        {mcpServers.length === 0 ? (
          <EmptyState
            icon={Plug}
            message="No MCP servers configured on any agents yet."
          />
        ) : (
          <div className="space-y-3">
            {mcpServers.map((mcp) => (
              <McpCard key={mcp.name} mcp={mcp} allAgents={allAgents} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
