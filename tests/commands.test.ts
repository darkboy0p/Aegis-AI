import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleCommand, COMMANDS } from '../apps/bot/src/commands.ts';
import type { Ix, CmdDeps } from '../apps/bot/src/commands.ts';
import { scanGuild } from '../apps/bot/src/scan.ts';
import { DiscordGateway } from '../apps/bot/src/gateway.ts';
import { MemoryProvider } from '../packages/core/src/db.ts';
import { TicketManager } from '../packages/tickets/src/tickets.ts';
import { IncidentManager, EmergencyMode } from '../packages/core/src/incident.ts';
import { ServerTwin } from '../packages/core/src/twin.ts';
import { AuditLog } from '../packages/core/src/audit.ts';
import { ModerationStore } from '../packages/moderation/src/moderation.ts';
import { Metrics } from '../packages/analytics/src/metrics.ts';
import { dailyReport } from '../packages/analytics/src/reports.ts';
import { Scheduler } from '../packages/core/src/scheduler.ts';

function setup() {
  const db = new MemoryProvider(); const audit = new AuditLog(); const twins = new Map<string, ServerTwin>();
  const admins = new Set(['admin']); const d: CmdDeps = { db, moderation: new ModerationStore(db), tickets: new TicketManager(db), incidents: new IncidentManager(), audit, defaultAutonomy: 1,
    emergency: new EmergencyMode(audit, async (_g, u) => admins.has(u)), twin: (g) => { if (!twins.has(g)) twins.set(g, new ServerTwin(g)); return twins.get(g)!; }, ask: async () => "", probes: async () => ({ Discord: { ok: true, latencyMs: 30 }, Database: { ok: true } }) };
  return { d, db, audit };
}
function ix(o: Partial<Ix> & { name: string }, out: string[]): Ix {
  return { guildId: '111111', userId: 'u', sub: undefined, str: () => null, int: () => null, isAdmin: false, canManageMessages: false, reply: async (t) => { out.push(t); }, ...o };
}
test('command definitions are valid for registration', () => {
  assert.equal(COMMANDS.length, 10); for (const c of COMMANDS) { assert.match(c.name, /^[a-z-]{1,32}$/); assert.ok(c.description.length <= 100); }
});
test('anyone can open a ticket; closing/stats need staff; @ mentions are neutralised', async () => {
  const { d } = setup(); const out: string[] = [];
  await handleCommand(d, ix({ name: 'ticket', sub: 'open', str: (n) => (n === 'subject' ? 'my account was hacked @everyone' : null) }, out)); assert.match(out[0], /Security \(URGENT\)/);
  const id = out[0].match(/Ticket (\S+)/)![1];
  await handleCommand(d, ix({ name: 'ticket', sub: 'close', str: () => id }, out)); assert.match(out[1], /need staff/);
  await handleCommand(d, ix({ name: 'ticket', sub: 'close', str: () => id, canManageMessages: true }, out)); assert.match(out[2], /closed/);
  await handleCommand(d, ix({ name: 'ticket', sub: 'close', str: () => 'nope', canManageMessages: true }, out)); assert.match(out[3], /not found/);
  await handleCommand(d, ix({ name: 'ticket', sub: 'stats', canManageMessages: true }, out)); assert.match(out[4], /1 total, 0 open/);
});
test('emergency: admin only, uses EmergencyMode authorization and audits', async () => {
  const { d, audit } = setup(); const out: string[] = [];
  await handleCommand(d, ix({ name: 'emergency', sub: 'on', str: () => 'raid' }, out)); assert.match(out[0], /Administrator/);
  await handleCommand(d, ix({ name: 'emergency', sub: 'on', str: () => 'raid', isAdmin: true, userId: 'admin' }, out)); assert.match(out[1], /ON/); assert.ok(d.emergency.isActive('111111'));
  await handleCommand(d, ix({ name: 'status' }, out)); assert.match(out[2], /Emergency mode: ACTIVE/);
  await handleCommand(d, ix({ name: 'emergency', sub: 'off', isAdmin: true, userId: 'admin' }, out)); assert.match(out[3], /OFF/); assert.ok(audit.list('111111').length >= 2);
});
test('autonomy: admin only, validated, persisted, picked up by gateway, cannot enable auto-critical', async () => {
  const { d, db, audit } = setup(); const out: string[] = [];
  await handleCommand(d, ix({ name: 'autonomy', sub: 'set', int: () => 4 }, out)); assert.match(out[0], /Administrator/);
  await handleCommand(d, ix({ name: 'autonomy', sub: 'set', int: () => 9, isAdmin: true }, out)); assert.match(out[1], /0-5/);
  await handleCommand(d, ix({ name: 'autonomy', sub: 'set', int: () => 5, isAdmin: true }, out));
  const gw = new DiscordGateway({ guilds: { fetch: async () => { throw new Error('x'); } } }, db, 1); const p = await gw.policy('111111'); assert.equal(p.autonomy, 5); assert.equal(p.allowAutoCritical, false);
  assert.equal((await gw.policy('222222')).autonomy, 1); assert.match(audit.list('111111')[0].detail ?? '', /1 -> 5/);
});
test('backup summary and DM guard', async () => {
  const { d, db } = setup(); const out: string[] = []; await db.set('111111', 'guildPolicies', 'main', { id: 'main' });
  await handleCommand(d, ix({ name: 'backup', isAdmin: true }, out)); assert.match(out[0], /guildPolicies=1/);
  await handleCommand(d, ix({ name: 'status', guildId: null }, out)); assert.match(out[1], /inside a server/);
});
test('scan: builds the twin, warns only on real gaps, never claims bot functionality', () => {
  const tw = new ServerTwin('g'); const roles = [1, 2, 3, 4].map((i) => ({ id: `r${i}`, name: `Admin${i}`, position: i, admin: true, managed: false }));
  const r = scanGuild({ id: 'g', name: 'Test', memberCount: 50, hasSystemChannel: false, roles, channels: [{ id: 'c', name: 'general', type: 'text' }], botIds: ['b1'], botHas: (p) => p !== 'ViewAuditLog' }, tw);
  assert.equal(r.warnings.length, 3); assert.match(r.report, /1 bots \(function of other bots not inspected\)/); assert.equal(tw.snapshot().adminRoles.length, 4);
  assert.equal(scanGuild({ id: 'g', name: 'T', memberCount: 1, hasSystemChannel: true, roles: [], channels: [], botIds: [], botHas: () => true }, new ServerTwin('g')).warnings.length, 0);
});
test('daily report reflects real counters; scheduler runOnStart:false does not fire immediately', async () => {
  const m = new Metrics(); const inc = new IncidentManager(); m.inc('g', 'spam_detections', 3); inc.open('g', 'raid', 'HIGH', ['x']);
  const r = dailyReport('g', m, inc, { total: 4, open: 1 }); assert.match(r, /spam_detections: 3/); assert.match(r, /Incidents opened: 1 \(1 still open\)/); assert.match(r, /Tickets: 4 total, 1 open/);
  const s = new Scheduler(); let n = 0; s.add({ name: 'd', everyMs: 1000, run: async () => { n++; }, runOnStart: false }); await s.tick(Date.now()); assert.equal(n, 0); await s.tick(Date.now() + 1500); assert.equal(n, 1);
});
