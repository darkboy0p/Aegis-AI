import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ModerationStore, recommend, DAY } from '../packages/moderation/src/moderation.ts';
import { MemoryProvider } from '../packages/core/src/db.ts';
import { handleCommand } from '../apps/bot/src/commands.ts';
import type { Ix, CmdDeps } from '../apps/bot/src/commands.ts';
import { handleMessage } from '../apps/bot/src/pipeline.ts';
import type { Deps } from '../apps/bot/src/pipeline.ts';
import { handleApi } from '../apps/bot/src/api.ts';
import { TicketManager } from '../packages/tickets/src/tickets.ts';
import { IncidentManager, EmergencyMode } from '../packages/core/src/incident.ts';
import { ServerTwin } from '../packages/core/src/twin.ts';
import { AuditLog } from '../packages/core/src/audit.ts';
import { CapabilityBroker } from '../packages/permissions/src/broker.ts';
import { AntiSpam } from '../packages/security/src/antispam.ts';

const staff = { moderatorId: 'mod', moderatorType: 'user' as const, source: 'manual' };
test('escalation ladder recommends but never bans; decays with time; overturned cases do not count', async () => {
  assert.equal(recommend(0).action, 'NONE'); assert.equal(recommend(1).action, 'WARN'); assert.equal(recommend(3).action, 'TIMEOUT'); assert.equal(recommend(9).action, 'KICK'); assert.match(recommend(9).explanation, /staff only/);
  const s = new ModerationStore(new MemoryProvider()); const t = 1e12;
  const a = await s.add('g', { userId: 'u', action: 'WARN', reason: 'x', ...staff }, t); await s.add('g', { userId: 'u', action: 'WARN', reason: 'y', ...staff }, t + 1);
  assert.equal(await s.activeWarnings('g', 'u', t + 2), 2); assert.equal(await s.activeWarnings('g', 'u', t + 31 * DAY), 0);
  await s.appeal('g', a.id, 'u', 'unfair'); await s.resolveAppeal('g', a.id, 'mod', 'overturned'); assert.equal(await s.activeWarnings('g', 'u', t + 2), 1);
});
test('automated actions require evidence; appeals: own cases only, once, needs pending; guild isolation', async () => {
  const s = new ModerationStore(new MemoryProvider());
  await assert.rejects(() => s.add('g', { userId: 'u', action: 'TIMEOUT', moderatorId: 'aegis', moderatorType: 'system', reason: 'spam', source: 'AntiSpam' }), /evidence/);
  const k = await s.add('g', { userId: 'u', action: 'WARN', reason: 'r', ...staff });
  await assert.rejects(() => s.appeal('g', k.id, 'other', 'x'), /your own/); await s.appeal('g', k.id, 'u', 'please'); await assert.rejects(() => s.appeal('g', k.id, 'u', 'again'), /already/);
  await assert.rejects(() => s.resolveAppeal('g2', k.id, 'mod', 'upheld'), /not found/); assert.equal((await s.resolveAppeal('g', k.id, 'mod', 'upheld')).status, 'active'); await assert.rejects(() => s.resolveAppeal('g', k.id, 'mod', 'upheld'), /no pending/);
  assert.deepEqual(await s.history('g2', 'u'), []);
});
function cmdSetup() {
  const db = new MemoryProvider(); const audit = new AuditLog();
  const d: CmdDeps = { db, moderation: new ModerationStore(db), tickets: new TicketManager(db), incidents: new IncidentManager(), audit, defaultAutonomy: 1, ask: async () => "", emergency: new EmergencyMode(audit, async () => false), twin: (g) => new ServerTwin(g), probes: async () => ({}) };
  return d;
}
const ix = (o: Partial<Ix> & { name: string }, out: string[]): Ix => ({ guildId: '111111', userId: 'u', str: () => null, int: () => null, isAdmin: false, canManageMessages: false, reply: async (t) => { out.push(t); }, ...o });
test('/warn, /history, /appeal flow with permission gates', async () => {
  const d = cmdSetup(); const out: string[] = []; const args = (m: Record<string, string>) => (n: string) => m[n] ?? null;
  await handleCommand(d, ix({ name: 'warn', str: args({ user: 'victim', reason: 'spam' }) }, out)); assert.match(out[0], /Moderate Members/);
  for (let i = 0; i < 3; i++) await handleCommand(d, ix({ name: 'warn', canModerate: true, userId: 'mod', str: args({ user: 'victim', reason: `r${i}` }) }, out));
  assert.match(out[3], /3 active warning\(s\).*TIMEOUT.*nothing was applied/s);
  await handleCommand(d, ix({ name: 'history', canModerate: true, str: args({ user: 'victim' }) }, out)); assert.equal(out[4].split('\n').length, 3);
  const id = out[1].match(/Case (\S+):/)![1];
  await handleCommand(d, ix({ name: 'appeal', sub: 'open', userId: 'stranger', str: args({ case: id, text: 'hi' }) }, out)); assert.match(out[5], /your own/);
  await handleCommand(d, ix({ name: 'appeal', sub: 'open', userId: 'victim', str: args({ case: id, text: 'unfair' }) }, out)); assert.match(out[6], /submitted/);
  await handleCommand(d, ix({ name: 'appeal', sub: 'resolve', userId: 'victim', str: args({ case: id, outcome: 'overturned' }) }, out)); assert.match(out[7], /Moderate Members/);
  await handleCommand(d, ix({ name: 'appeal', sub: 'resolve', canModerate: true, userId: 'mod', str: args({ case: id, outcome: 'overturned' }) }, out)); assert.match(out[8], /overturned.*no longer counts/);
});
test('pipeline records automated actions as evidenced cases', async () => {
  const db = new MemoryProvider(); const moderation = new ModerationStore(db);
  const gw = { policy: async () => ({ autonomy: 4 as const, disabledTools: [], protectedIds: [], allowAutoCritical: false }), actorHasPermission: async () => true, botHasPermission: async () => true, botCanActOn: async () => true, execute: async () => 1 };
  const deps: Deps = { broker: new CapabilityBroker(gw, new AuditLog()), spam: new AntiSpam(), notify: async () => {}, state: { ai: 'UNKNOWN' }, id: () => 'c', moderation };
  const m = { guildId: '111111', channelId: 'c', messageId: 'm', authorId: 'spammer', authorIsBot: false, mentions: 0, mentionsBot: false };
  for (let i = 0; i < 4; i++) await handleMessage(deps, { ...m, content: 'BUY' });
  await handleMessage(deps, { ...m, authorId: 'phisher', content: 'free nitro claim your gift http://discord-gifts.xyz' });
  const h = await moderation.history('111111', 'spammer'); assert.equal(h[0].action, 'TIMEOUT'); assert.match(h[0].evidence[0], /4 identical/); assert.equal(h[0].moderatorType, 'system');
  assert.equal((await moderation.history('111111', 'phisher'))[0].action, 'DELETE');
});
test('API serves incidents/tickets/moderation per guild behind auth, validates ids', async () => {
  const seen: string[] = []; const d = { token: 'tok', allowedOrigin: 'x', audit: new AuditLog(), status: async () => ({}), data: async (k: string, g: string) => { seen.push(`${k}:${g}`); return [{ k }]; } };
  assert.equal((await handleApi(d, 'GET', '/api/tickets/123456', undefined)).status, 401);
  assert.equal((await handleApi(d, 'GET', '/api/moderation/123456', 'Bearer tok')).status, 200); assert.deepEqual(seen, ['moderation:123456']);
  assert.equal((await handleApi(d, 'GET', '/api/incidents/12', 'Bearer tok')).status, 404); assert.equal((await handleApi(d, 'GET', '/api/secrets/123456', 'Bearer tok')).status, 404);
});
