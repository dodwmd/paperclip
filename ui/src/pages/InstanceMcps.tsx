import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plug, Trash2 } from "lucide-react";
import type { InstanceMcpServerAgent, InstanceMcpServerEntry } from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { heartbeatsApi } from "../api/heartbeats";
import { agentsApi } from "../api/agents";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

  const data = mcpQuery.data;
  const mcpServers = data?.mcpServers ?? [];
  const allAgents = data?.allAgents ?? [];

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
    <div className="max-w-5xl space-y-6">
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
  );
}
