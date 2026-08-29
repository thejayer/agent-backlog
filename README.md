# Agent Backlog

[![CI](https://github.com/thejayer/agent-backlog/actions/workflows/ci.yml/badge.svg)](https://github.com/thejayer/agent-backlog/actions/workflows/ci.yml)

A small task board that your **coding agents claim work from**.

Most backlogs are written for humans. Agent Backlog stores each task as a
structured **work packet** that renders itself as a ready-to-use agent prompt,
and gives agents a tiny HTTP contract to **claim** a packet (with a lease, so two
agents never grab the same one) and **write status back** (branch, PR, tests,
files changed, blockers, next steps). A human console sits on top for triage,
review, and GitHub sync.

It runs out of the box with **zero cloud setup** — file-backed storage, one
command to start. Firestore is an optional backend when you want to deploy it.

> **Working name.** "Agent Backlog" and the `agent-backlog` package name are
> placeholders — rename freely. Internally the app/env vars use the `MANAGE_`
> prefix; that is just a name, not a dependency on anything external.

## Quickstart

```bash
npm install
npm run dev          # Vite dev server + API at http://127.0.0.1:5186
```

Open http://127.0.0.1:5186 and sign in with the local **operator** token
**`manage-local`**. Agents use a separate bearer token, **`manage-local-agent`**,
when those env vars are unset. You'll get a seeded demo backlog across a few
example repos.

To run the built app the way it ships in production:

```bash
npm run build        # bundles the UI into dist/manage
npm start            # serves UI + API from manage/server.mjs (PORT=4186)
```

Verify the core flow without a browser:

```bash
npm run smoke        # boots the server and exercises the agent endpoints
```

## How an agent uses it

```bash
export MANAGE_AUTH_TOKEN="manage-local-agent"   # the agent bearer token

# 1. Read the instructions and claim the next ready packet for a repo
curl -H "Authorization: Bearer $MANAGE_AUTH_TOKEN" \
  -X POST http://127.0.0.1:5186/api/agent/next/claim \
  -H 'Content-Type: application/json' \
  -d '{"repo":"web-app","agent":"Codex","leaseMinutes":90}'

# 2. Fetch a specific packet as a copy-paste prompt
curl -H "Authorization: Bearer $MANAGE_AUTH_TOKEN" \
  http://127.0.0.1:5186/agent/TASK-101.md

# 3. Write status back when a PR is open
curl -H "Authorization: Bearer $MANAGE_AUTH_TOKEN" \
  -X POST http://127.0.0.1:5186/api/agent/tasks/TASK-101/status \
  -H 'Content-Type: application/json' \
  -d '{"status":"needs_review","note":"Opened a PR","githubPrUrl":"https://github.com/your-org/web-app/pull/1"}'
```

There's also a lifecycle CLI that wraps these calls:

```bash
npm run agent -- doctor
npm run agent -- next-key
npm run agent -- create --title "Harden login rate limits" --repo web-app --ready
npm run agent -- claim-next --repo web-app
npm run agent -- progress TASK-101 --note "Implementation started"
npm run agent -- extend TASK-101 --lease-minutes 60
npm run agent -- reclaim TASK-101
npm run agent -- release TASK-101
npm run agent -- review TASK-101 --branch codex/task-101-fix --pr https://github.com/your-org/web-app/pull/1
npm run agent -- closeout TASK-101 --repo your-org/web-app --pr 1   # verifies the merged PR via gh
```

## Core ideas

- **Work packet** — a task with the context an agent needs: summary, desired
  outcome, acceptance criteria, relevant files, test commands, and handoff
  fields. `GET /agent/{key}.md` renders it as a prompt; `GET /api/agent/tasks/{key}`
  returns the structured JSON plus the rendered prompt.
- **Lease-based claiming** — `POST /api/agent/next/claim` (or `/tasks/{key}/claim`)
  marks a packet claimed for `leaseMinutes`. A second claim on a live lease gets
  `409`. Expired leases become available again automatically.
- **Run health + recovery** — claimed and in-progress packets expose derived
  `agentRunHealth` (`healthy`, `expiring`, `stale`, `incomplete`, `failed`, or
  `idle`). Authenticated callers can `extend` the lease, `reclaim` a stuck run,
  or `release` it back to `ready_for_agent` without waiting the lease out.
- **Status writeback** — `POST /api/agent/tasks/{key}/status` records
  `needs_review` / `done` / `blocked` with branch, PR, tests run, files changed,
  blockers, and next steps, and appends to a per-packet event log.
- **Readiness + priority ranking** — `next` hands out the highest-priority,
  most-complete `ready_for_agent` packet first.
- **GitHub sync (optional)** — pull open PRs/issues/branches/failed runs per repo
  and auto-link them to packets; import issues as draft packets.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Liveness + storage kind (public) |
| GET | `/api/auth/session` | Current session (public) |
| GET | `/api/work-items` | List packets |
| POST | `/api/work-items` | Create a packet |
| PATCH | `/api/work-items/{key}` | Edit a packet |
| GET | `/api/agent/next?repo=&label=` | Peek at the next ready packet |
| GET | `/api/agent/next-key` | Next unused `TASK-*` key |
| POST | `/api/agent/next/claim` | Claim the next ready packet |
| POST | `/api/agent/tasks` | Create a packet (agent lifecycle) |
| POST | `/api/agent/tasks/{key}/claim` | Claim a specific packet |
| POST | `/api/agent/tasks/{key}/status` | Write status back |
| POST | `/api/agent/tasks/{key}/recovery` | Recover a run: `extend`, `reclaim`, or `release` (operator) |
| GET | `/agent/{key}.md` | Packet as a Markdown prompt |
| GET | `/agent/instructions.md` | Agent onboarding instructions |
| GET | `/api/agent/bootstrap` | Machine-readable endpoint + command map |
| POST | `/api/github/sync` | Refresh GitHub cache (`{"mock":true}` for demo) |
| GET/POST | `/api/backups` | List / create state snapshots |

All routes except the public ones require a signed operator session cookie or
`Authorization: Bearer <MANAGE_AUTH_TOKEN>` for agent lifecycle routes.

## Auth

Roles: **operator/admin** (full), **viewer** (`workspace:view`), **agent**
(`agent:read` + `agent:lifecycle`).

- **Agents** use `MANAGE_AUTH_TOKEN` as a bearer token for claim, status,
  bootstrap, next, next-key, and `POST /api/agent/tasks`. That token **cannot**
  create a browser session.
- **Humans** sign in with GitHub OAuth (allowlisted logins via
  `MANAGE_ALLOWED_GITHUB_LOGINS`) and/or a separate operator / break-glass token
  (`MANAGE_OPERATOR_TOKEN`, local default `manage-local`). The two tokens must
  differ.
- Cookie-authenticated writes require a same-origin `Origin` header or
  `x-csrf-protection: 1`.
- In production the server **refuses to start** if `MANAGE_AUTH_TOKEN` or
  `MANAGE_AUTH_SECRET` is missing, or if the operator and agent tokens collide.

## Storage

- **`file`** (default) — JSON under `manage/data/`, with automatic pre-write
  snapshots. No external services.
- **`firestore`** — set `MANAGE_STORAGE_BACKEND=firestore` and provide GCP
  credentials. `@google-cloud/firestore` installs as an optional dependency and
  is only loaded in this mode.

See [`.env.example`](.env.example) for the full configuration surface.

## Deploy

```bash
docker build -t agent-backlog .
docker run -p 8080:8080 \
  -e NODE_ENV=production \
  -e MANAGE_AUTH_TOKEN=... \
  -e MANAGE_AUTH_SECRET=... \
  -e MANAGE_OPERATOR_TOKEN=... \
  agent-backlog
```

The image builds the UI and serves UI + API from `manage/server.mjs` on `:8080`.

## Tests

- `npm run smoke` — Node-only API smoke (no browser).
- `npm run test:unit` — Vitest unit tests for run health, recovery, and the CLI.
- `npm test` — Playwright UI + API suite (`npx playwright install chromium` first).

## License

MIT — see [LICENSE](LICENSE).
