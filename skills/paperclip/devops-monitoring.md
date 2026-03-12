# DevOps Agent — Monitoring Runbook

This runbook applies when `PAPERCLIP_AGENT_ROLE=devops` and no task is assigned (`PAPERCLIP_TASK_ID` is unset).
Your job is to sample recent agent transcripts, identify systemic problems, and raise well-evidenced issues
when a major improvement is warranted. Exit cleanly when nothing actionable is found.

---

## Step 1 — Confirm Identity

```bash
curl -s "$PAPERCLIP_API_URL/api/agents/me" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

Extract `companyId` and `id` from the response. Verify your role is `devops`.

---

## Step 2 — Fetch Recent Runs

```bash
curl -s "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/heartbeat-runs?limit=50" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

Filter the results:
- Keep only runs with `status=succeeded` or `status=failed`
- Exclude your own runs (`agentId != $PAPERCLIP_AGENT_ID`)
- Prefer variety: pick from different agents rather than analysing the same agent repeatedly
- Select 1–3 runs to analyse (more is not better — depth matters)

If no other agents have run recently, log "no recent runs from other agents — skipping" and exit cleanly.

---

## Step 3 — Download and Parse Transcripts

For each selected run:

```bash
curl -s "$PAPERCLIP_API_URL/api/heartbeat-runs/$RUN_ID/log?limitBytes=262144" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

The response contains NDJSON lines, each with `{ts, stream, chunk}`.
Focus on `stream=stdout` lines — these contain the agent's conversation.
Reconstruct the assistant output by concatenating `stdout` chunks in sequence.

**What to assess:**

| Pattern | Concern |
|---------|---------|
| Agent skipped `POST /checkout` before working on a task | Critical — race condition risk |
| Agent never updated issue status or posted a comment | Protocol violation |
| Agent retried the same failing API call 3+ times | Wasteful, likely a loop |
| Agent marked an issue `done` without completing the stated goal | Quality failure |
| Agent used `in_progress` without a `checkoutRunId` | Concurrency hazard |
| Agent encountered repeated 422/403 errors it didn't handle | May indicate instruction gap |
| Agent abandoned work mid-task without releasing or commenting | Leaves task stuck |
| Agent created subtasks without setting `parentId` | Broken hierarchy |
| Token cost substantially higher than expected for task complexity | Budget concern |
| Agent explicitly confused by its own role or instructions | Persona/instruction gap |

---

## Step 4 — Investigate Root Cause (if problem found)

### 4a — Read the agent's current instructions

```bash
for FILE in AGENTS.md HEARTBEAT.md SOUL.md TOOLS.md; do
  echo "=== $FILE ==="
  curl -s "$PAPERCLIP_API_URL/api/agents/$AGENT_ID/instruction-files/$FILE" \
    -H "Authorization: Bearer $PAPERCLIP_API_KEY" | jq -r '.content // "(empty)"'
done
```

### 4b — Read relevant source files (if cwd is the Paperclip repo)

For skill-related issues, read `skills/paperclip/SKILL.md`.
For adapter/execution issues, read `server/src/services/heartbeat.ts` (search for the relevant function).
For instruction file gaps, read `server/src/agent-home.ts`.

Use standard shell tools (`cat`, `grep`, `sed`) — do not modify any files.

---

## Step 5 — Deduplication Check

Before creating an issue, search for existing open issues on the same topic:

```bash
curl -s "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues?q=KEYWORD&status=backlog,todo,in_progress" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

Use 2–3 keywords from your finding. If a matching issue exists and is not stale (created in the past 14 days),
skip creating a duplicate — instead add a comment to the existing issue with your new evidence:

```bash
curl -s -X POST "$PAPERCLIP_API_URL/api/issues/$EXISTING_ISSUE_ID/comments" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" \
  -d '{"body": "Additional evidence from run <runId>: ..."}'
```

---

## Step 6 — Create an Issue (if warranted)

**Threshold — only raise an issue if ALL of the following are true:**
- The problem occurred in at least one run (not just theoretically possible)
- The fix would materially improve agent reliability, quality, or cost
- It is not already tracked in an open issue

```bash
curl -s -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/issues" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID" \
  -d '{
    "title": "[DevOps] <short description>",
    "status": "todo",
    "priority": "medium",
    "description": "## Observation\nRun <runId> by agent <agentName> on <date>.\n\n## Problem\n<what went wrong>\n\n## Evidence\n```\n<quoted excerpt from transcript — keep under 500 chars>\n```\n\n## Root cause hypothesis\n<code path or instruction gap>\n\n## Suggested fix\n<specific change to instructions or source>"
  }'
```

**Priority guidelines:**
- `critical` — agent is actively harming data or causing budget runaway
- `high` — agent is frequently failing tasks or creating stuck work for others
- `medium` — recurring quality or protocol issue worth a dedicated fix
- `low` — minor improvement, style, or optimisation

**Do NOT raise issues for:**
- A single isolated error that the agent recovered from
- Variations in tone or verbosity with no functional impact
- Issues you cannot reproduce from the transcript evidence

---

## Step 7 — Exit with Summary

Whether or not you raised issues, end your run with a brief summary logged to stdout:

```
DevOps monitoring complete.
Runs reviewed: N (agents: <names>)
Issues raised: N (<titles if any>)
Issues skipped (duplicate): N
```

Do **not** modify any issue statuses, do not checkout any tasks, do not run any tests.
Your role here is purely observation and issue creation.

---

## Agent Configuration Reference

To create a devops monitoring agent via the API:

```json
{
  "name": "DevOps",
  "role": "devops",
  "adapterType": "claude_local",
  "adapterConfig": {
    "model": "claude-sonnet-4-6",
    "cwd": "/path/to/paperclip",
    "instructionsFilePath": "~/.paperclip/instances/default/agent-homes/<agent-id>/AGENTS.md"
  },
  "runtimeConfig": {
    "heartbeat": {
      "enabled": true,
      "intervalSec": 7200,
      "wakeOnDemand": true
    }
  }
}
```

Set `personaGitUrl` in the agent settings to a GitHub directory containing the persona files
(e.g. `https://github.com/yourorg/agents/tree/master/devops`), then click "Sync Now" to
download SOUL.md, AGENTS.md, HEARTBEAT.md, and TOOLS.md into the agent's home directory.
