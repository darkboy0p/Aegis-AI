import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryProvider } from '../packages/core/src/db.ts';
import { MemoryStore } from '../packages/memory/src/memory.ts';
import { TicketManager, classify } from '../packages/tickets/src/tickets.ts';
import { ServerTwin } from '../packages/core/src/twin.ts';
import { KnowledgeBase } from '../packages/core/src/knowledge.ts';
import { Metrics } from '../packages/analytics/src/metrics.ts';
import { evaluate, withRetry } from '../packages/core/src/diagnostics.ts';
import { Scheduler } from '../packages/core/src/scheduler.ts';
import { FirebaseProvider } from '../packages/core/src/firebase.ts';
import type { FsLike } from '../packages/core/src/firebase.ts';
import { exportGuild, importGuild } from '../packages/core/src/backup.ts';

const H = 3_600_000;
test('memory: ranking, expiry, guild isolation, forget user', async () => {
  const m = new MemoryStore(new MemoryProvider()); const t = 1e12;
  await m.add('g1', 'server', 'Moderators are called Testers here', { importance: 0.9, source: 'staff:1', now: t });
  await m.add('g1', 'working', 'scratch about testers', { source: 'ai', now: t }); await m.add('g1', 'user', 'prefers DMs', { source: 'user:42', now: t });
  const r = await m.retrieve('g1', 'who are the testers', { now: t + 1 }); assert.equal(r[0].tier, 'server');
  assert.equal((await m.retrieve('g1', 'testers', { tier: 'working', now: t + 2 * H })).length, 0);
  assert.equal((await m.retrieve('g2', 'testers', { now: t + 1 })).length, 0);
  assert.equal(await m.purgeExpired('g1', t + 2 * H), 1); assert.equal(await m.forgetUser('g1', '42'), 1); assert.equal(await m.forgetUser('g1', '42'), 0);
});
test('tickets: classification, lifecycle, escalation, inactivity, isolation', async () => {
  assert.deepEqual(classify('my account was hacked, urgent'), { type: 'Security', priority: 'URGENT' }); assert.equal(classify('please unban me').type, 'Ban Appeal'); assert.equal(classify('random words').type, 'Other');
  const tm = new TicketManager(new MemoryProvider()); const t = await tm.create('g1', 'u1', 'I found a bug in the shop', 1000);
  assert.equal(t.type, 'Bug'); await tm.assign('g1', t.id, 'staff1', 2000); await tm.note('g1', t.id, 'staff1', 'looking', 3000);
  assert.equal((await tm.inactive('g1', 5000, 9000)).length, 1); assert.equal((await tm.inactive('g1', 5000, 4000)).length, 0);
  await tm.close('g1', t.id, 5000); await tm.reopen('g1', t.id, 6000); assert.equal((await tm.reopen('g1', t.id, 7000)).priority, 'HIGH');
  await assert.rejects(() => tm.close('g2', t.id)); assert.deepEqual(await tm.stats('g1'), { total: 1, open: 1, byType: { Bug: 1 } });
});
test('digital twin: tracks events and alerts on new admin / protected role edits', () => {
  const tw = new ServerTwin('g', ['r1']);
  tw.apply({ kind: 'roleCreate', id: 'r1', name: 'Mod', position: 5, admin: false }); tw.apply({ kind: 'channelCreate', id: 'c1', name: 'general', type: 'text' });
  tw.apply({ kind: 'memberJoin', id: 'b1', bot: true }); tw.apply({ kind: 'memberJoin', id: 'u1', bot: false });
  const a = tw.apply({ kind: 'roleUpdate', id: 'r1', name: 'Mod', position: 5, admin: true }); assert.deepEqual(a.map((x) => x.type), ['admin_granted', 'protected_role_change']);
  assert.deepEqual(tw.snapshot().adminRoles, ['r1']); tw.apply({ kind: 'memberLeave', id: 'b1' }); tw.apply({ kind: 'channelDelete', id: 'c1' });
  const s = tw.snapshot(); assert.equal(s.bots, 0); assert.equal(s.channels, 0); assert.equal(s.memberCount, 1);
});
test('knowledge: inference is not fact until confirmed; stale decay; unknown default', () => {
  const k = new KnowledgeBase(); assert.equal(k.get('g', 'mod_role').certainty, 'UNKNOWN');
  k.learn('g', 'mod_role', 'Testers', 'observed', 0); assert.equal(k.get('g', 'mod_role').certainty, 'INFERRED'); k.learn('g', 'mod_role', 'Testers', 'observed', 1); assert.equal(k.get('g', 'mod_role').certainty, 'INFERRED');
  assert.ok(k.confirm('g', 'mod_role', 'admin', 2)); assert.equal(k.get('g', 'mod_role').certainty, 'KNOWN'); assert.equal(k.get('g2', 'mod_role').certainty, 'UNKNOWN');
  assert.equal(k.decay('g', 100, 1000), 1); assert.equal(k.get('g', 'mod_role').certainty, 'STALE');
});
test('analytics: hourly buckets, windows, per-guild reports', () => {
  const m = new Metrics(); const now = 100 * H; m.inc('g', 'spam', 2, now); m.inc('g', 'spam', 1, now - 30 * H); m.inc('g2', 'spam', 9, now);
  assert.equal(m.total('g', 'spam', 24 * H, now), 2); assert.equal(m.total('g', 'spam', 48 * H, now), 3); assert.match(m.report('g', 'Security report', ['spam'], 24 * H, now), /spam: 2/);
});
test('diagnostics states and bounded retry', async () => {
  const ok = { ok: true, latencyMs: 20 };
  assert.equal(evaluate({ Discord: ok, Database: ok, AI: ok }).state, 'HEALTHY'); assert.equal(evaluate({ Discord: ok, Database: ok, AI: { ok: false } }).state, 'DEGRADED');
  assert.equal(evaluate({ Discord: { ok: false }, Database: ok }).state, 'CRITICAL'); assert.equal(evaluate({ Discord: { ok: false }, Database: { ok: false } }).state, 'OFFLINE');
  assert.equal(evaluate({ Discord: { ok: true, latencyMs: 5000 } }).state, 'WARNING'); assert.equal(evaluate({ Discord: ok }, { heapUsedRatio: 0.9 }).state, 'WARNING');
  let n = 0; const sleeps: number[] = []; assert.equal(await withRetry(async () => { if (++n < 3) throw new Error('503'); return 'ok'; }, { sleep: async (ms) => { sleeps.push(ms); } }), 'ok'); assert.deepEqual(sleeps, [200, 400]);
  n = 0; await assert.rejects(() => withRetry(async () => { n++; throw new Error('403 forbidden'); }, { isTransient: (e) => !/403/.test(e.message), sleep: async () => {} })); assert.equal(n, 1);
});
test('scheduler runs due jobs once per interval and contains failures', async () => {
  const s = new Scheduler(); let a = 0; s.add({ name: 'daily', everyMs: 1000, run: async () => { a++; } }); s.add({ name: 'bad', everyMs: 1000, run: async () => { throw new Error('boom'); } });
  await s.tick(0); await s.tick(500); await s.tick(1000); assert.equal(a, 2); assert.equal(s.errors.length, 2); assert.match(s.errors[0], /bad: boom/);
});
function fakeFs(): FsLike { const d = new Map<string, unknown>(); return { doc: (p) => ({ get: async () => ({ exists: d.has(p), data: () => d.get(p) }), set: async (v) => { d.set(p, v); }, delete: async () => { d.delete(p); } }),
  collection: (p) => ({ get: async () => ({ docs: [...d].filter(([k]) => k.startsWith(p + '/')).map(([, v]) => ({ data: () => v })) }) }) }; }
test('FirebaseProvider: rooted paths, isolation, path-injection rejected', async () => {
  const db = new FirebaseProvider(fakeFs()); await db.set('g1', 'guildTickets', 't1', { a: 1 });
  assert.deepEqual(await db.get('g1', 'guildTickets', 't1'), { a: 1 }); assert.deepEqual(await db.list('g2', 'guildTickets'), []); assert.equal(await db.get('g2', 'guildTickets', 't1'), undefined);
  await assert.rejects(() => db.get('g1/../g2', 'guildTickets', 't1')); await db.delete('g1', 'guildTickets', 't1'); assert.equal(await db.get('g1', 'guildTickets', 't1'), undefined); assert.equal(await db.health(), true);
});
test('backup: round trip, refuses other guild or unknown collection', async () => {
  const db = new MemoryProvider(); await db.set('g1', 'guildPolicies', 'main', { id: 'main', autonomy: 2 }); const b = await exportGuild(db, 'g1');
  const db2 = new MemoryProvider(); assert.equal(await importGuild(db2, 'g1', b), 1); assert.deepEqual(await db2.get('g1', 'guildPolicies', 'main'), { id: 'main', autonomy: 2 });
  await assert.rejects(() => importGuild(db2, 'g2', b)); await assert.rejects(() => importGuild(db2, 'g1', { ...b, data: { guildAudit: [] } }));
});
