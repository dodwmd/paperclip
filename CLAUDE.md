# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What is Paperclip

Paperclip is a control plane for AI-agent companies. It orchestrates agents, manages tasks/issues, enforces budgets, and provides a board UI for human operators. The V1 spec is in `doc/SPEC-implementation.md`.

## Common Commands

```sh
pnpm install              # Install all dependencies
pnpm dev                  # Start API + UI (http://localhost:3100)
pnpm dev:server           # API only
pnpm dev:ui               # UI only (needs API running)

pnpm -r typecheck         # Typecheck all packages
pnpm test:run             # Run all tests once (Vitest)
pnpm test                 # Run tests in watch mode
pnpm build                # Build all packages

pnpm db:generate          # Generate migration from schema changes (compiles first)
pnpm db:migrate           # Apply pending migrations

pnpm check:tokens         # Check for forbidden tokens in code
```

### Verification before hand-off (must all pass):
```sh
pnpm -r typecheck && pnpm test:run && pnpm build
```

### Run a single test file:
```sh
pnpm vitest run path/to/test.ts
```

## Monorepo Structure

**pnpm workspaces** with these packages:

| Package | Purpose |
|---------|---------|
| `server/` | Express 5 REST API, orchestration services, auth middleware |
| `ui/` | React 19 + Vite 6 dashboard (Tailwind CSS 4, Radix UI, TanStack Query) |
| `cli/` | CLI tool (`paperclipai`), esbuild bundled |
| `packages/db/` | Drizzle ORM schema, migrations, DB client (PGlite in dev, Postgres in prod) |
| `packages/shared/` | Shared types, Zod validators, API path constants |
| `packages/adapter-utils/` | Base utilities for agent adapters |
| `packages/adapters/*` | Agent adapters: claude-local, codex-local, openclaw |
| `skills/` | Agent skills (paperclip, create-agent, para-memory-files) |

## Architecture

### API & Auth
- Base path: `/api`
- Two actor types: **board** (human operator, full access) and **agent** (bearer API key, company-scoped)
- Deployment modes: `local_trusted` (dev, implicit board) vs `authenticated` (explicit sessions via Better-Auth)
- Routes in `server/src/routes/`, services in `server/src/services/`
- Auth middleware: `server/src/middleware/auth.ts` attaches actor context to requests

### Database
- Drizzle ORM with schema in `packages/db/src/schema/*.ts`
- Dev uses embedded PGlite (no external DB needed), data at `~/.paperclip/instances/default/db`
- Config reads compiled JS: `packages/db/drizzle.config.ts` → `dist/schema/*.js`

### Frontend
- React Router for client-side routing, pages in `ui/src/pages/`
- API clients in `ui/src/api/`, state via TanStack Query
- Served by API server in dev middleware mode (same origin)

### Heartbeat System
The heartbeat service (`server/src/services/heartbeat.ts`) is the core orchestration loop — it schedules agent invocations, manages agent state (active/paused/idle/running/error), enforces budget hard-stops, and detects stuck runs.

## Critical Engineering Rules

1. **Company scoping**: Every domain entity belongs to one company. All queries must filter by `company_id`. Routes must enforce company boundaries.

2. **Contract synchronization**: Changes to schema/API must propagate across all layers: `packages/db` → `packages/shared` → `server` → `ui`. Run full typecheck after.

3. **Database change workflow**:
   - Edit `packages/db/src/schema/*.ts`
   - Export new tables from `packages/db/src/schema/index.ts`
   - Run `pnpm db:generate` (compiles then generates migration)
   - Run `pnpm -r typecheck`

4. **Activity logging**: All mutations must log to `activity_log` via `logActivity()`.

5. **Control-plane invariants**: Atomic single-assignee task checkout, approval gates for governed actions, budget hard-stop auto-pause.

6. **Consistent HTTP errors**: Routes return `400/401/403/404/409/422/500`.

## Key Documentation

- `doc/SPEC-implementation.md` — V1 build contract (start here for requirements)
- `doc/GOAL.md` — Product vision
- `doc/PRODUCT.md` — Feature overview
- `doc/DEVELOPING.md` — Development guide
- `doc/DATABASE.md` — Database design
- `doc/DEPLOYMENT-MODES.md` — Auth modes
- `doc/CLI.md` — CLI command reference
- `AGENTS.md` — Engineering guidelines for contributors

## Environment Variables

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | External Postgres (leave unset for embedded PGlite) |
| `PAPERCLIP_HOME` | Workspace root (default `~/.paperclip`) |
| `PAPERCLIP_INSTANCE_ID` | Instance name (default `default`) |
| `PAPERCLIP_MIGRATION_PROMPT=never` | Skip migration prompts |
| `PAPERCLIP_SECRETS_STRICT_MODE=true` | Enforce secret references for sensitive env keys |
| `HOST` | Bind address (`0.0.0.0` for remote access) |
| `PORT` | Server port (default `3100`) |
