// Entry point. Requires `npm install` (discord.js) and a persistent Node process.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../../packages/core/src/config.ts';
import { AuditLog } from '../../../packages/core/src/audit.ts';
import { MemoryProvider } from '../../../packages/core/src/db.ts';
import type { DatabaseProvider } from '../../../packages/core/src/db.ts';
import { FirebaseProvider } from '../../../packages/core/src/firebase.ts';
import type { FsLike } from '../../../packages/core/src/firebase.ts';
import { CapabilityBroker } from '../../../packages/permissions/src/broker.ts';
import { AntiSpam } from '../../../packages/security/src/antispam.ts';
import { MockProvider, OpenAICompatProvider, GeminiProvider } from '../../../packages/ai/src/provider.ts';
import type { AIProvider, FetchFn } from '../../../packages/ai/src/provider.ts';
import { DiscordGateway } from './gateway.ts';
import type { DjsClient } from './gateway.ts';
import { handleMessage } from './pipeline.ts';
import { handleApi } from './api.ts';
import type { Health } from './api.ts';
import { IncidentManager, EmergencyMode } from '../../../packages/core/src/incident.ts';
import { SecurityCenter } from '../../../packages/core/src/center.ts';
import { TicketManager } from '../../../packages/tickets/src/tickets.ts';
import { ServerTwin } from '../../../packages/core/src/twin.ts';
import { Metrics } from '../../../packages/analytics/src/metrics.ts';
import { dailyReport } from '../../../packages/analytics/src/reports.ts';
import { Scheduler } from '../../../packages/core/src/scheduler.ts';
import { ModerationStore } from '../../../packages/moderation/src/moderation.ts';
import { COMMANDS, handleCommand } from './commands.ts';
import { planTasks, runPlan } from '../../../packages/tasks/src/planner.ts';
import { evaluate } from '../../../packages/core/src/diagnostics.ts';
import type { DataKind } from './api.ts';
import { scanGuild } from './scan.ts';
import type { ScanGuild } from './scan.ts';

const cfg = loadConfig(process.env);
const env = process.env;
const f: FetchFn = (u, i) => fetch(u, i) as ReturnType<FetchFn>;
const ai: AIProvider = cfg.aiProvider === 'groq' || cfg.aiProvider === 'openrouter' ? new OpenAICompatProvider(cfg.aiProvider, env.AI_API_KEY!, cfg.aiModel, f)
  : cfg.aiProvider === 'gemini' ? new GeminiProvider(env.AI_API_KEY!, cfg.aiModel, f) : new MockProvider();
let db: DatabaseProvider = new MemoryProvider(); // in-memory fallback: data is lost on restart
if (env.FIREBASE_PROJECT_ID && env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
  const { initializeApp, cert } = await import('firebase-admin/app'); const { getFirestore } = await import('firebase-admin/firestore');
  const fs = getFirestore(initializeApp({ credential: cert({ projectId: env.FIREBASE_PROJECT_ID, clientEmail: env.FIREBASE_CLIENT_EMAIL, privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') }) }));
  db = new FirebaseProvider(fs as unknown as FsLike);
}
const audit = new AuditLog();
const { Client, GatewayIntentBits, Events } = await import('discord.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
const broker = new CapabilityBroker(new DiscordGateway(client as unknown as DjsClient, db, cfg.autonomy), audit);
const state: { ai: Health } = { ai: 'UNKNOWN' };
const moderation = new ModerationStore(db); const metrics = new Metrics(); const tickets = new TicketManager(db); const twins = new Map<string, ServerTwin>();
const twin = (g: string) => { if (!twins.has(g)) twins.set(g, new ServerTwin(g)); return twins.get(g)!; };
const incidents = new IncidentManager();
const emergency = new EmergencyMode(audit, async (g, u) => { try { return (await (await client.guilds.fetch(g)).members.fetch(u)).permissions.has('Administrator'); } catch { return false; } });
const notify = async (g: string, text: string) => { const ch = (await client.guilds.fetch(g)).systemChannel; await ch?.send(text.slice(0, 1900)); };
const center = new SecurityCenter({ incidents, emergency, notify, autoEmergency: env.AUTO_EMERGENCY === 'true', ownerIds: [] });
const deps = { moderation, metrics, emergency, broker, spam: new AntiSpam(), ai, state, id: () => randomUUID(),
  notify: async (g: string, text: string) => { const ch = (await client.guilds.fetch(g)).systemChannel; await ch?.send(text.slice(0, 1900)); } };

client.on(Events.MessageCreate, (m) => {
  if (!m.guildId || !client.user) return;
  handleMessage(deps, { guildId: m.guildId, channelId: m.channelId, messageId: m.id, authorId: m.author.id, authorIsBot: m.author.bot, content: m.content,
    mentions: m.mentions.users.size, mentionsBot: m.mentions.has(client.user) }).catch((e) => console.error('pipeline error:', (e as Error).message));
});
client.on(Events.GuildMemberAdd, (m) => { center.onJoin(m.guild.id, m.id, m.user.createdTimestamp).catch((e) => console.error('join handler:', (e as Error).message)); });
// Audit-log executor lookup is best effort: entries can lag behind the event, and it needs the View Audit Log permission.
async function executor(guild: { fetchAuditLogs(o: { type: number; limit: number }): Promise<{ entries: { first(): { executorId: string | null } | undefined } }>; id: string }, type: number) {
  try { return (await guild.fetchAuditLogs({ type, limit: 1 })).entries.first()?.executorId ?? null; } catch { return null; }
}
const watch = (event: (typeof Events)[keyof typeof Events], type: number, kind: 'channelDelete' | 'roleDelete' | 'ban') => client.on(event as 'channelDelete', async (x: any) => {
  const g = x.guild; if (!g) return; const a = await executor(g, type); if (a && a !== client.user?.id) await center.onAdminEvent(g.id, a, kind).catch((e) => console.error('nuke handler:', (e as Error).message));
});
watch(Events.ChannelDelete, 12, 'channelDelete'); watch(Events.GuildRoleDelete, 32, 'roleDelete'); watch(Events.GuildBanAdd, 22, 'ban');
// --- slash commands, scan on join, twin sync, scheduled jobs (wiring not yet exercised against real Discord) ---
const probes = async () => ({ Discord: { ok: client.isReady(), latencyMs: client.ws.ping }, Database: { ok: await db.health() } });
const taskLog = new Map<string, { at: string; request: string; source: string; tasks: string }[]>();
async function ask(g: string, text: string) {
  const { tasks, source } = await planTasks(text, ai); const t = twin(g);
  const r = await runPlan(tasks, {
    serverHealth: async () => { const h = evaluate(await probes()); const sn = t.snapshot(); return `Server health: ${h.state}${h.issues.length ? ` (${h.issues.join(', ')})` : ''}. Known: ${sn.roles} roles, ${sn.channels} channels, ${sn.bots} bots.`; },
    securityAnalysis: async () => { const a = incidents.active(g); return `Security: ${a.length} open incident(s)${a.length ? ': ' + a.map((i) => `${i.id} ${i.type} ${i.severity}`).join(', ') : ''}. Emergency mode ${emergency.isActive(g) ? 'ACTIVE' : 'off'}.`; },
    ticketSummary: async () => { const s = await tickets.stats(g); return `Tickets: ${s.total} total, ${s.open} open${Object.keys(s.byType).length ? ' (' + Object.entries(s.byType).map(([k, v]) => `${k} ${v}`).join(', ') + ')' : ''}.`; },
    moderationSummary: async () => { const c = await moderation.recent(g, 200); const d = Date.now() - 86_400_000; return `Moderation (24h): ${c.filter((x) => x.createdAt > d).length} case(s), ${c.filter((x) => x.appeal?.status === 'pending').length} pending appeal(s).`; },
  });
  taskLog.set(g, [...(taskLog.get(g) ?? []).slice(-49), { at: new Date().toISOString(), request: text.slice(0, 100), source, tasks: [...r.states].map(([id, s]) => `${id}:${s.status}`).join(' ') }]);
  return `${r.text}
(plan source: ${source})`;
}
client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand()) return; metrics.inc(i.guildId ?? 'dm', 'commands');
  try { await i.deferReply({ flags: 64 }); await handleCommand({ ask, db, moderation, tickets, emergency, incidents, twin, audit, probes, defaultAutonomy: cfg.autonomy }, { guildId: i.guildId, userId: i.user.id, name: i.commandName, sub: i.options.getSubcommand(false) ?? undefined,
    str: (n) => i.options.getString(n), int: (n) => i.options.getInteger(n), isAdmin: !!i.memberPermissions?.has('Administrator'), canManageMessages: !!i.memberPermissions?.has('ManageMessages'), canModerate: !!i.memberPermissions?.has('ModerateMembers'),
    reply: async (t) => { await i.editReply({ content: t.slice(0, 1900), allowedMentions: { parse: [] } }); } }); } catch (e) { console.error('command error:', (e as Error).message); }
});
function toScan(g: any): ScanGuild {
  return { id: g.id, name: g.name, memberCount: g.memberCount, hasSystemChannel: !!g.systemChannel, botHas: (p: string) => g.members.me?.permissions.has(p) ?? false,
    roles: [...g.roles.cache.values()].map((r: any) => ({ id: r.id, name: r.name, position: r.position, admin: r.permissions.has('Administrator'), managed: r.managed })),
    channels: [...g.channels.cache.values()].map((c: any) => ({ id: c.id, name: c.name, type: String(c.type), parentId: c.parentId ?? undefined })), botIds: [...g.members.cache.filter((m: any) => m.user.bot).keys()] };
}
client.on(Events.GuildCreate, async (g) => { // also fires for existing guilds at startup: only post the report for guilds joined in the last minute
  const r = scanGuild(toScan(g), twin(g.id)); if (Date.now() - (g.joinedTimestamp ?? 0) < 60_000) await notify(g.id, r.report).catch(() => {});
});
const roleEv = (kind: 'roleCreate' | 'roleUpdate') => (a: any, b?: any) => { const r = b ?? a; for (const al of twin(r.guild.id).apply({ kind, id: r.id, name: r.name, position: r.position, admin: r.permissions.has('Administrator'), managed: r.managed })) notify(r.guild.id, `${al.text}. Check who changed it.`).catch(() => {}); };
client.on(Events.GuildRoleCreate, roleEv('roleCreate')); client.on(Events.GuildRoleUpdate, roleEv('roleUpdate')); client.on(Events.GuildRoleDelete, (r) => { twin(r.guild.id).apply({ kind: 'roleDelete', id: r.id }); });
client.on(Events.ChannelCreate, (c) => { twin(c.guild.id).apply({ kind: 'channelCreate', id: c.id, name: c.name, type: String(c.type) }); }); client.on(Events.ChannelDelete, (c: any) => { if (c.guild) twin(c.guild.id).apply({ kind: 'channelDelete', id: c.id }); });
const scheduler = new Scheduler();
scheduler.add({ name: 'daily-report', everyMs: 24 * 3_600_000, runOnStart: false, run: async () => { for (const g of client.guilds.cache.keys()) await notify(g, dailyReport(g, metrics, incidents, await tickets.stats(g))); } });
scheduler.add({ name: 'ticket-reminders', everyMs: 24 * 3_600_000, runOnStart: false, run: async () => { for (const g of client.guilds.cache.keys()) { const n = (await tickets.inactive(g, 24 * 3_600_000)).length; if (n) await notify(g, `${n} open ticket(s) have had no activity for 24h.`); } } });
client.once(Events.ClientReady, (c) => scheduler.start(); c.application.commands.set(COMMANDS as never).catch((e) => console.error('command registration failed:', (e as Error).message));
  console.log(`Aegis connected as ${c.user.tag} in ${c.guilds.cache.size} guild(s), autonomy ${cfg.autonomy}`));

const started = Date.now();
const api = { token: env.DASHBOARD_API_TOKEN ?? '', allowedOrigin: env.DASHBOARD_ORIGIN ?? 'http://localhost:8080', audit,
  data: async (k: DataKind, g: string): Promise<unknown[]> => {
    if (k === 'incidents') return incidents.list(g); if (k === 'tickets') return db.list(g, 'guildTickets'); if (k === 'moderation') return moderation.recent(g);
    if (k === 'roles') return [...twin(g).roles].map(([id, r]) => ({ id, ...r })); if (k === 'channels') return [...twin(g).channels].map(([id, c]) => ({ id, ...c })); if (k === 'tasks') return taskLog.get(g) ?? [];
    if (k === 'analytics') return ['messages_seen', 'spam_detections', 'phishing_removed', 'ai_requests', 'commands'].map((n) => ({ metric: n, last24h: metrics.total(g, n, 86_400_000), last7d: metrics.total(g, n, 7 * 86_400_000) }));
    const p = ((await db.get(g, 'guildPolicies', 'main')) ?? {}) as Record<string, unknown>; return [{ autonomy: p.autonomy ?? cfg.autonomy, allowAutoCritical: p.allowAutoCritical ?? false, disabledTools: JSON.stringify(p.disabledTools ?? []), protectedIds: JSON.stringify(p.protectedIds ?? []) }]; // settings: policy only, never secrets
  },
  status: async () => ({ mode: 'LIVE', uptimeSec: Math.floor((Date.now() - started) / 1000), guilds: client.guilds.cache.size, autonomy: cfg.autonomy, aiProvider: cfg.aiProvider,
    components: { Discord: client.isReady() ? (client.ws.ping < 1000 ? 'ONLINE' : 'DEGRADED') : 'OFFLINE', Database: (await db.health()) ? 'ONLINE' : 'OFFLINE', AI: state.ai,
      Security: 'ONLINE', Firebase: db instanceof FirebaseProvider ? ((await db.health()) ? 'ONLINE' : 'OFFLINE') : 'UNKNOWN', Voice: 'UNKNOWN', 'Task Engine': 'UNKNOWN' }, discordPingMs: client.ws.ping }) };
createServer(async (req, res) => {
  const r = await handleApi(api, req.method ?? 'GET', (req.url ?? '/').split('?')[0], req.headers.authorization);
  res.writeHead(r.status, { 'content-type': 'application/json', ...r.headers }); res.end(r.body === null ? '' : JSON.stringify(r.body));
}).listen(Number(env.API_PORT ?? 8787), '127.0.0.1');
await client.login(env.DISCORD_BOT_TOKEN);
