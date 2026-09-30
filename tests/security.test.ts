import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AntiRaid } from '../packages/security/src/antiraid.ts';
import { AntiNuke } from '../packages/security/src/antinuke.ts';
import { analyzeMessage } from '../packages/security/src/antiphish.ts';
import { IncidentManager, EmergencyMode } from '../packages/core/src/incident.ts';
import { SecurityCenter } from '../packages/core/src/center.ts';
import { AuditLog } from '../packages/core/src/audit.ts';
import { handleMessage } from '../apps/bot/src/pipeline.ts';
import type { Deps } from '../apps/bot/src/pipeline.ts';
import { AntiSpam } from '../packages/security/src/antispam.ts';
import { CapabilityBroker } from '../packages/permissions/src/broker.ts';

const DAY = 86_400_000;
test('anti-raid: burst of new accounts is high confidence; slow or old joins are not flagged', () => {
  const r = new AntiRaid(); let d = null; const now = 1e12;
  for (let i = 0; i < 10; i++) d = r.observeJoin('g', `u${i}`, now - DAY, now + i * 100);
  assert.equal(d?.confidence, 'high'); assert.equal(d!.userIds.length, 10); assert.match(d!.evidence, /10 joins/);
  const s = new AntiRaid(); let x = null; for (let i = 0; i < 20; i++) x = s.observeJoin('g', `u${i}`, now - DAY, now + i * 60_000); assert.equal(x, null);
  const old = new AntiRaid(); let y = null; for (let i = 0; i < 10; i++) y = old.observeJoin('g', `u${i}`, now - 900 * DAY, now + i); assert.equal(y?.confidence, 'medium');
});
test('anti-nuke: mass deletes flagged per actor, owner exempt, guilds separate', () => {
  const n = new AntiNuke(['owner']); let d = null; for (let i = 0; i < 3; i++) d = n.observe('g', 'evil', 'channelDelete', 1000 + i);
  assert.equal(d?.actorId, 'evil'); assert.equal(n.observe('g2', 'evil', 'channelDelete', 1010), null);
  for (let i = 0; i < 9; i++) assert.equal(n.observe('g', 'owner', 'ban', 2000 + i), null);
  assert.equal(new AntiNuke().observe('g', 'a', 'channelDelete', 1), null);
});
test('anti-phishing: lookalikes score high, official and plain links do not', () => {
  const bad = analyzeMessage('FREE NITRO claim your gift http://discord-gifts.xyz/x'); assert.ok(bad.score >= 70); assert.ok(bad.reasons.some((r) => /lookalike/.test(r)));
  assert.ok(analyzeMessage('http://xn--dscord-9ya.com/login').score >= 35); assert.ok(analyzeMessage('http://user@1.2.3.4/a').score >= 60);
  assert.equal(analyzeMessage('docs: https://discord.com/developers and https://github.com/x/y').score, 0); assert.equal(analyzeMessage('no links here, free nitro talk').score, 0);
  assert.ok(analyzeMessage('https://evil.com/?u=discord.com').score === 0); // query text alone is not a lookalike host
});
test('emergency mode: authorization, audit, expiry, sensitivity', async () => {
  const a = new AuditLog(); const em = new EmergencyMode(a, async (_g, u) => u === 'admin', 1000);
  assert.equal((await em.activate('g', 'rando', 'user', 'x', 0)).ok, false); assert.equal(em.isActive('g', 1), false);
  assert.equal((await em.activate('g', 'admin', 'user', 'raid', 0)).ok, true); assert.equal(em.isActive('g', 500), true); assert.equal(em.sensitivity('g', 500), 0.5);
  assert.equal(em.isActive('g', 1500), false); assert.equal(em.sensitivity('g', 1500), 1);
  assert.equal(em.isActive('other', 500), false);
  assert.deepEqual(a.list('g').map((r) => r.result), ['denied', 'executed', 'executed']); assert.ok(a.verify('g'));
  await em.activate('g', 'admin', 'user', 'r', 0); assert.equal(await em.deactivate('g', 'rando'), false); assert.equal(await em.deactivate('g', 'admin'), true); assert.equal(em.isActive('g', 1), false);
});
test('incidents: timeline, report, guild isolation', () => {
  const m = new IncidentManager(); const i = m.open('g1', 'raid', 'HIGH', ['10 joins']); m.addEvent('g1', i.id, 'notified', 'staff alerted'); m.close('g1', i.id);
  assert.match(m.report('g1', i.id), /10 joins[\s\S]*notified[\s\S]*closed/); assert.throws(() => m.report('g2', i.id)); assert.deepEqual(m.list('g2'), []); assert.equal(m.active('g1').length, 0);
});
function center(auto: boolean) {
  const audit = new AuditLog(); const notes: string[] = []; const incidents = new IncidentManager(); const emergency = new EmergencyMode(audit, async () => true);
  return { c: new SecurityCenter({ incidents, emergency, notify: async (_g, t) => { notes.push(t); }, autoEmergency: auto, ownerIds: ['owner'] }), incidents, emergency, notes };
}
test('security center: raid opens ONE incident, alerts once, auto-emergency only when configured', async () => {
  const now = Date.now(); const a = center(true);
  for (let i = 0; i < 15; i++) await a.c.onJoin('g', `u${i}`, now - DAY, now + i);
  assert.equal(a.incidents.list('g').length, 1); assert.equal(a.notes.length, 1); assert.ok(a.emergency.isActive('g', now + 20));
  const b = center(false); for (let i = 0; i < 15; i++) await b.c.onJoin('g', `u${i}`, now - DAY, now + i);
  assert.equal(b.emergency.isActive('g', now + 20), false); assert.equal(b.incidents.list('g').length, 1);
});
test('security center: nuke incident names the actor; owner ignored', async () => {
  const x = center(false); for (let i = 0; i < 3; i++) await x.c.onAdminEvent('g', 'evil', 'roleDelete', 5000 + i); for (let i = 0; i < 9; i++) await x.c.onAdminEvent('g', 'owner', 'roleDelete', 5000 + i);
  assert.equal(x.incidents.list('g').length, 1); assert.equal(x.incidents.list('g')[0].actorId, 'evil'); assert.match(x.notes[0], /evil/);
});
test('pipeline: phishing removed without punishment; emergency lowers the bar', async () => {
  const log: string[] = []; const notes: string[] = []; let em = false;
  const gw = { policy: async () => ({ autonomy: 2 as const, disabledTools: [], protectedIds: [], allowAutoCritical: false }), actorHasPermission: async () => true, botHasPermission: async () => true, botCanActOn: async () => true, execute: async (r: { tool: string }) => { log.push(r.tool); return 1; } };
  const deps: Deps = { broker: new CapabilityBroker(gw, new AuditLog()), spam: new AntiSpam(), notify: async (_g, t) => { notes.push(t); }, state: { ai: 'UNKNOWN' }, id: () => 'c', emergency: { isActive: () => em } };
  const base = { guildId: '111111', channelId: 'c', messageId: 'm', authorId: 'u', authorIsBot: false, mentions: 0, mentionsBot: false };
  const o = await handleMessage(deps, { ...base, content: 'free nitro claim your gift http://discord-gifts.xyz' }); assert.equal(o.kind, 'phishing'); assert.deepEqual(log, ['deleteMessage']); assert.match(notes[0], /no punishment/);
  const mid = 'grab http://bit.ly/abc or http://prizes.top/x claim your reward'; assert.equal((await handleMessage(deps, { ...base, content: mid })).kind, 'ignored');
  em = true; assert.equal((await handleMessage(deps, { ...base, content: mid })).kind, 'phishing');
  assert.equal((await handleMessage(deps, { ...base, content: 'see https://github.com/a/b' })).kind, 'ignored');
});
