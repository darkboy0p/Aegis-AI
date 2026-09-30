import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan, heuristicPlan, planTasks, runPlan } from '../packages/tasks/src/planner.ts';
import type { Handlers } from '../packages/tasks/src/planner.ts';
import { MockProvider } from '../packages/ai/src/provider.ts';
import { handleCommand } from '../apps/bot/src/commands.ts';
import type { Ix } from '../apps/bot/src/commands.ts';
import { handleApi } from '../apps/bot/src/api.ts';
import { AuditLog } from '../packages/core/src/audit.ts';

const P = (tasks: unknown) => JSON.stringify({ tasks });
test('plan validation rejects unknown kinds, cycles, dupes, bad deps, oversize, junk', () => {
  assert.equal(validatePlan(P([{ id: 'a', kind: 'serverHealth', deps: [] }, { id: 'r', kind: 'report', deps: ['a'] }])).errors.length, 0);
  for (const bad of [P([{ id: 'a', kind: 'banMember', deps: [] }]), P([{ id: 'a', kind: 'report', deps: ['b'] }, { id: 'b', kind: 'report', deps: ['a'] }]), P([{ id: 'a', kind: 'report', deps: [] }, { id: 'a', kind: 'report', deps: [] }]),
    P([{ id: 'a', kind: 'report', deps: ['zzz'] }]), P(Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, kind: 'serverHealth', deps: [] }))), 'nope', P([])]) assert.ok(validatePlan(bad).errors.length > 0);
});
test('heuristic plan decomposes the spec example without any AI', () => {
  const t = heuristicPlan("Check the server, analyze security, summarize today's tickets, and make me a report");
  assert.deepEqual(t.map((x) => x.kind), ['serverHealth', 'securityAnalysis', 'ticketSummary', 'report']); assert.deepEqual(t[3].deps, ['serverHealth', 'securityAnalysis', 'ticketSummary']);
  assert.equal(heuristicPlan('hello there')[0].kind, 'serverHealth');
});
test('AI plan used when valid; invalid, hostile or unavailable AI falls back to rules', async () => {
  const good = new MockProvider([P([{ id: 'x', kind: 'ticketSummary', deps: [] }])]); const a = await planTasks('tickets?', good); assert.equal(a.source, 'ai'); assert.match(good.calls[0].user, /<untrusted_discord_message>/);
  assert.equal((await planTasks('check server', new MockProvider([P([{ id: 'x', kind: 'banMember', deps: [] }])]))).source, 'rules');
  const down = { name: 'd', generate: async () => { throw new Error('down'); }, healthCheck: async () => false, getModelInfo: () => ({ provider: 'd', model: 'd' }) };
  assert.equal((await planTasks('check server', down)).source, 'rules'); assert.equal((await planTasks('check server')).source, 'rules');
});
test('runPlan: independent tasks overlap, report waits, one failing handler does not sink the report', async () => {
  let active = 0, max = 0; const slow = (s: string) => async () => { active++; max = Math.max(max, active); await new Promise((r) => setTimeout(r, 30)); active--; return s; };
  const h: Handlers = { serverHealth: slow('HEALTH ok'), securityAnalysis: async () => { throw new Error('twin offline'); }, ticketSummary: slow('TICKETS 2'), moderationSummary: slow('MOD 0') };
  const plan = heuristicPlan('check server security tickets and report'); const r = await runPlan(plan, h);
  assert.ok(max >= 2); assert.match(r.text, /HEALTH ok/); assert.match(r.text, /TICKETS 2/); assert.match(r.text, /securityAnalysis: unavailable \(twin offline\)/); assert.equal(r.states.get('report')!.status, 'done');
});
test('/ask: staff only, runs the planner, output cannot ping', async () => {
  const out: string[] = []; const d: any = { ask: async (_g: string, q: string) => `ran: ${q} @everyone` };
  const ix = (o: Partial<Ix>): Ix => ({ guildId: '111111', userId: 'u', name: 'ask', str: () => 'check server', int: () => null, isAdmin: false, canManageMessages: false, reply: async (t) => { out.push(t); }, ...o });
  await handleCommand(d, ix({})); assert.match(out[0], /staff permissions/); await handleCommand(d, ix({ canManageMessages: true })); assert.match(out[1], /ran: check server @\u200beveryone/);
});
test('API exposes only whitelisted view kinds; settings route is whitelisted, secrets route is not', async () => {
  const d = { token: 't', allowedOrigin: 'x', audit: new AuditLog(), status: async () => ({}), data: async (k: string) => [{ k }] };
  for (const k of ['roles', 'channels', 'tasks', 'analytics', 'settings']) assert.equal((await handleApi(d, 'GET', `/api/${k}/123456`, 'Bearer t')).status, 200);
  for (const k of ['env', 'config', 'tokens', 'memory']) assert.equal((await handleApi(d, 'GET', `/api/${k}/123456`, 'Bearer t')).status, 404);
});
