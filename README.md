# Aegis AI (core foundation)

Autonomous Discord operations layer. **This is a tested foundation, not the full spec** — see "Status" below.

## Architecture / hosting reality
GitHub (source, CI) -> GitHub Pages (static dashboard only) -> Firebase Firestore (data) -> AI provider (API) -> **Persistent Node.js process (the Discord bot)**.
GitHub Pages and Actions cannot run the Discord gateway 24/7; the bot needs an always-on Node runtime (your PC, VPS, or a host that allows long-running processes — free tiers of such hosts are limited/sleep).

## Implemented and tested (`npm test`, Node >= 22.18, no dependencies)
- `CapabilityBroker`: tool registry with schemas, risk levels SAFE..CRITICAL, autonomy levels 0-5, protected targets, bot/actor permission and role-hierarchy checks, confirmation flow, result verification, audit of every decision (`packages/permissions`)
- Hash-chained audit log with tamper detection; secret redaction (`packages/core`)
- `DatabaseProvider` + guild-isolated `MemoryProvider` (`packages/core`)
- Anti-spam detector with evidence; prompt-injection scanner and untrusted-input fencing (`packages/security`)
- `TaskOrchestrator`: dependencies, parallelism, priorities, resource locks, retries, timeouts, cancellation (`packages/tasks`)
- Dashboard with clearly labelled DEMO MODE, no network calls (`apps/dashboard`), deployed by `.github/workflows/ci.yml`
- Firestore rules (client read-only, bot writes via Admin SDK), `.env.example`, secret-scan script

## Bot and web (added)
- `apps/bot/src/main.ts`: discord.js client, message pipeline (spam rules -> DecisionEngine -> broker; @mention -> AI planner -> broker), read-only status/audit API on 127.0.0.1 with bearer token. Start: `npm install && npm start` (needs Node >= 22.18 and real credentials).
- `pipeline.ts`, `gateway.ts`, `api.ts` are unit-tested with fakes. **`main.ts` and the real discord.js calls have never been run** (no network in the build sandbox), so expect first-run fixes.
- Dashboard: DEMO by default; "Connect live" reads `/api/status` (Discord/Database/AI health; everything without a real check shows UNKNOWN). Only Overview is live-wired.
- `lockdownServer` and `generateReport` are registered but fail closed (not implemented). Data is in-memory (lost on restart) until FirebaseProvider exists.

## Security Center (added)
- AntiRaid (join bursts + account age), AntiNuke (per-actor destructive events, trusted actors exempt), AntiPhishing (heuristic URL scoring with listed reasons; no network lookups), IncidentManager (timeline + report, guild-isolated), EmergencyMode (admin-authorized manual, optional auto via `AUTO_EMERGENCY=true`, TTL expiry, audited, lowers thresholds), SecurityCenter (detect -> one incident -> alert staff -> optional emergency).
- Phishing is wired into the message pipeline (removes the message, no punishment). Join/channel/role/ban events are wired in `main.ts` but **untested against real Discord**; nuke detection depends on audit-log lookups that can lag.
- The center only alerts and deletes/flags: automatic lockdown is NOT implemented (`lockdownServer` fails closed).

## Engines (added, unit-tested, not yet wired into the bot's runtime loop)
`MemoryStore` (8 tiers, importance ranking, expiry, retention, per-user deletion) · `TicketManager` (9 types, priority, assign, notes, close/reopen escalation, inactivity, stats) · `ServerTwin` (event-driven mirror + admin-grant / protected-role alerts) · `KnowledgeBase` (KNOWN/INFERRED/UNKNOWN/STALE) · `Metrics` + text reports · `evaluate()` health states + `withRetry` · `Scheduler` · `FirebaseProvider` (used by `main.ts` when Firebase env vars are set; untested against real Firestore) · `exportGuild/importGuild` backup.
Nothing above is reachable from Discord yet: no ticket channels/commands, no scan on join, no scheduled reports posted. Those hooks are the next step.

## Commands and runtime wiring (added)
Slash commands `/status /ticket open|close|stats /emergency on|off /autonomy set /incident /backup` (`apps/bot/src/commands.ts`, unit-tested with fake interactions: permission gates, @-mention neutralising, audit entries, per-guild policy). On guild join Aegis scans what Discord exposes into the digital twin and posts a report with real warnings only (`scan.ts`). Role/channel events keep the twin in sync and alert on new Administrator grants. A daily report and 24h ticket-inactivity reminder run from the Scheduler. `/autonomy` can never enable auto-approval of CRITICAL actions.
**All Discord-facing wiring in `main.ts` is unrun.** Scan uses discord.js caches, so the bot list can be incomplete without a full member fetch. `/backup` only summarises; file export and restore are not implemented.

## Moderation (added)
`ModerationStore`: cases (WARN/DELETE/TIMEOUT/KICK/BAN) with evidence, per-user history, 30-day warning decay, appeals (own cases only, one per case, staff resolve; overturned cases stop counting). Automated actions **must** carry evidence or they are rejected. `recommend()` suggests WARN/TIMEOUT/KICK from active warnings and never suggests a ban; `/warn` records the case and shows the recommendation but applies nothing. New commands: `/warn /history /appeal open|resolve`. Spam timeouts and phishing deletions are recorded automatically as evidenced cases.
Dashboard live mode now also loads **Security (incidents), Tickets and Moderation** tables per Guild ID via `/api/incidents|tickets|moderation/:guildId`. The API token is a single admin token that can read every guild the bot is in; keep it secret and use a private host.

## Task planner and more dashboard sections (added)
`/ask <request>` (staff): the request is split into **read-only** tasks (serverHealth, securityAnalysis, ticketSummary, moderationSummary, report) by the AI if available (output strictly validated: known kinds only, no cycles, max 8) or by keyword rules if not, then run through the TaskOrchestrator (independent tasks in parallel, report waits for its inputs, a failing task is reported as unavailable instead of sinking the report). A planned task can never change the server.
Dashboard live mode now also covers Roles, Channels, Tasks, Analytics, Settings (policy only, never secrets) and Audit (with hash-chain validity) in addition to Security/Tickets/Moderation. Members, Voice, AI, Memory, Learning, Evolution and System (beyond the Overview health grid) are still not wired.

## Not implemented yet
Voice, self-repair actions, self-evolution and GitHub PR pipeline, dashboard sections Members, Voice, AI, Memory, Learning, Evolution, System detail, CLI/command for backup restore. Each should be added behind the existing broker/provider interfaces.

## Run
`cp .env.example .env`, then `npm install && npm test`. `npm run typecheck` needs TypeScript installed (not yet run).
