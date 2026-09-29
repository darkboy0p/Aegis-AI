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

## Not implemented yet
discord.js bot runtime and slash commands, FirebaseProvider, AI providers (Groq/Gemini/OpenRouter/mock), digital twin, server scan, decision engine, incident/emergency mode, anti-raid/nuke/phishing, moderation engine, tickets, voice, analytics, memory tiers, diagnostics/self-repair, self-evolution and GitHub PR pipeline, live dashboard, backups. Each should be added behind the existing broker/provider interfaces.

## Run
`cp .env.example .env`, then `npm install && npm test`. `npm run typecheck` needs TypeScript installed (not yet run).
