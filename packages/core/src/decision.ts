import type { CapabilityRequest, Risk } from '../../shared/src/types.ts';
import type { Detection } from '../../security/src/antispam.ts';
import { TOOLS } from '../../permissions/src/broker.ts';
export interface Decision { intent: string; proposed: CapabilityRequest[]; risk: Risk; confidence: Detection['confidence']; explanation: string; }
const order: Risk[] = ['SAFE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
// Deterministic, AI-free rules: works when every AI provider is down. Only high-confidence evidence produces actions.
export function decideSpam(d: Detection, ctx: { guildId: string; channelId: string; messageId: string; correlationId: string }): Decision {
  const base = { guildId: ctx.guildId, actorId: 'aegis-rules', actorType: 'system' as const, correlationId: ctx.correlationId };
  const proposed: CapabilityRequest[] = [];
  if (d.confidence === 'high') {
    proposed.push({ ...base, tool: 'deleteMessage', input: { channelId: ctx.channelId, messageId: ctx.messageId } });
    proposed.push({ ...base, tool: 'timeoutMember', input: { memberId: d.userId, reason: `AntiSpam: ${d.type}` }, targetId: d.userId });
  }
  const risk = proposed.reduce<Risk>((m, r) => (order.indexOf(TOOLS[r.tool].risk) > order.indexOf(m) ? TOOLS[r.tool].risk : m), 'SAFE');
  return { intent: proposed.length ? 'moderate_spam' : 'monitor', proposed, risk, confidence: d.confidence,
    explanation: `${proposed.length ? 'Action' : 'Monitor only'}: ${d.type}. Evidence: ${d.evidence}. Confidence: ${d.confidence}.` };
}
