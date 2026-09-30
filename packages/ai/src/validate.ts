import { TOOLS } from '../../permissions/src/broker.ts';
import type { CapabilityRequest } from '../../shared/src/types.ts';
export interface Parsed { requests: CapabilityRequest[]; errors: string[]; }
const MAX_ACTIONS = 5;
// Model output is untrusted. Only known tools survive; guild/actor/confirmation are set by us, never by the model.
export function parseCapabilityRequests(raw: string, ctx: { guildId: string; correlationId: string }): Parsed {
  const errors: string[] = []; const requests: CapabilityRequest[] = [];
  let j: any;
  try { j = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')); } catch { return { requests, errors: ['output is not valid JSON'] }; }
  if (!j || !Array.isArray(j.actions)) return { requests, errors: ['missing actions array'] };
  for (const [i, a] of j.actions.slice(0, MAX_ACTIONS).entries()) {
    if (!a || typeof a.tool !== 'string' || !Object.hasOwn(TOOLS, a.tool)) { errors.push(`action ${i}: unknown tool`); continue; }
    requests.push({ guildId: ctx.guildId, actorId: 'aegis-ai', actorType: 'ai', tool: a.tool, input: a.input ?? {}, correlationId: ctx.correlationId,
      ...(typeof a.targetId === 'string' ? { targetId: a.targetId } : {}) });
  }
  if (j.actions.length > MAX_ACTIONS) errors.push(`truncated to ${MAX_ACTIONS} actions`);
  return { requests, errors };
}
