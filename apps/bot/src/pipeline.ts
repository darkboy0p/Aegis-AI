import type { CapabilityBroker } from '../../../packages/permissions/src/broker.ts';
import type { AntiSpam } from '../../../packages/security/src/antispam.ts';
import type { AIProvider } from '../../../packages/ai/src/provider.ts';
import { planFromMessage } from '../../../packages/ai/src/planner.ts';
import { decideSpam } from '../../../packages/core/src/decision.ts';
import { analyzeMessage } from '../../../packages/security/src/antiphish.ts';
import type { CapabilityRequest } from '../../../packages/shared/src/types.ts';
export interface Msg { guildId: string; channelId: string; messageId: string; authorId: string; authorIsBot: boolean; content: string; mentions: number; mentionsBot: boolean; }
export interface Deps { broker: CapabilityBroker; spam: AntiSpam; ai?: AIProvider; notify(guildId: string, text: string): Promise<void>; state: { ai: 'ONLINE' | 'OFFLINE' | 'UNKNOWN' }; id(): string; emergency?: { isActive(guildId: string): boolean }; metrics?: { inc(guildId: string, name: string): void }; moderation?: { add(guildId: string, c: { userId: string; action: 'DELETE' | 'TIMEOUT'; moderatorId: string; moderatorType: 'system'; reason: string; evidence: string[]; source: string }): Promise<unknown> }; }
export interface Outcome { kind: 'ignored' | 'phishing' | 'spam' | 'ai' | 'ai_unavailable'; statuses: string[]; }
async function run(d: Deps, reqs: CapabilityRequest[], note: string, gid: string): Promise<string[]> {
  const out: string[] = [];
  for (const r of reqs) {
    const res = await d.broker.submit(r); out.push(res.status);
    if (res.status === 'needs_confirmation') await d.notify(gid, `Approval needed: ${r.tool} (${res.reason}). ${note}`);
  }
  return out;
}
export async function handleMessage(d: Deps, m: Msg): Promise<Outcome> {
  if (m.authorIsBot) return { kind: 'ignored', statuses: [] };
  const cid = d.id(); d.metrics?.inc(m.guildId, 'messages_seen');
  const ph = analyzeMessage(m.content);
  if (ph.score >= (d.emergency?.isActive(m.guildId) ? 40 : 70)) { // stricter link handling during emergency mode
    const del: CapabilityRequest = { guildId: m.guildId, actorId: 'aegis-rules', actorType: 'system', tool: 'deleteMessage', input: { channelId: m.channelId, messageId: m.messageId }, correlationId: cid };
    d.metrics?.inc(m.guildId, 'phishing_removed');
    const statuses = await run(d, [del], `Suspected phishing (score ${ph.score}): ${ph.reasons.join('; ')}`, m.guildId);
    if (statuses[0] === 'executed') await d.moderation?.add(m.guildId, { userId: m.authorId, action: 'DELETE', moderatorId: 'aegis-rules', moderatorType: 'system', reason: 'Suspected phishing link', evidence: ph.reasons, source: 'AntiPhishing' });
    await d.notify(m.guildId, `Suspected phishing from <@${m.authorId}> (score ${ph.score}): ${ph.reasons.join('; ')}. Message ${statuses[0] === 'executed' ? 'removed' : 'left in place'}; no punishment applied.`);
    return { kind: 'phishing', statuses };
  }
  const det = d.spam.observe(m.guildId, m.authorId, m.content, Date.now(), m.mentions);
  if (det) {
    d.metrics?.inc(m.guildId, 'spam_detections');
    const dec = decideSpam(det, { guildId: m.guildId, channelId: m.channelId, messageId: m.messageId, correlationId: cid });
    const statuses = await run(d, dec.proposed, dec.explanation, m.guildId);
    if (statuses[1] === 'executed') await d.moderation?.add(m.guildId, { userId: m.authorId, action: 'TIMEOUT', moderatorId: 'aegis-rules', moderatorType: 'system', reason: `AntiSpam: ${det.type}`, evidence: [det.evidence], source: 'AntiSpam' });
    return { kind: 'spam', statuses };
  }
  if (m.mentionsBot && d.ai) {
    d.metrics?.inc(m.guildId, 'ai_requests');
    const plan = await planFromMessage(d.ai, m.content, { guildId: m.guildId, correlationId: cid });
    d.state.ai = plan.aiAvailable ? 'ONLINE' : 'OFFLINE';
    if (plan.injectionSuspected) await d.notify(m.guildId, `Possible prompt-injection attempt by <@${m.authorId}> (no actions taken).`);
    if (!plan.aiAvailable) return { kind: 'ai_unavailable', statuses: [] };
    return { kind: 'ai', statuses: await run(d, plan.requests, 'Proposed by AI.', m.guildId) };
  }
  return { kind: 'ignored', statuses: [] };
}
