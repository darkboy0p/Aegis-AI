import { RISK_ORDER } from '../../shared/src/types.ts';
import type { Risk, AutonomyLevel, CapabilityRequest, Decision, GuildPolicy } from '../../shared/src/types.ts';
import type { AuditLog } from '../../core/src/audit.ts';

export interface ToolDef { name: string; risk: Risk; permission: string; validate(input: unknown): string | null; }
const obj = (i: unknown): i is Record<string, unknown> => typeof i === 'object' && i !== null;
const need = (...keys: string[]) => (i: unknown) => (obj(i) && keys.every((k) => typeof i[k] === 'string' && (i[k] as string).length > 0) ? null : `requires string fields: ${keys.join(',')}`);
export const TOOLS: Record<string, ToolDef> = Object.fromEntries([
  { name: 'getServerStatus', risk: 'SAFE', permission: 'ViewChannel', validate: () => null },
  { name: 'generateReport', risk: 'SAFE', permission: 'ViewChannel', validate: need('kind') },
  { name: 'sendMessage', risk: 'LOW', permission: 'SendMessages', validate: need('channelId', 'content') },
  { name: 'deleteMessage', risk: 'MEDIUM', permission: 'ManageMessages', validate: need('channelId', 'messageId') },
  { name: 'timeoutMember', risk: 'HIGH', permission: 'ModerateMembers', validate: need('memberId', 'reason') },
  { name: 'kickMember', risk: 'HIGH', permission: 'KickMembers', validate: need('memberId', 'reason') },
  { name: 'banMember', risk: 'CRITICAL', permission: 'BanMembers', validate: need('memberId', 'reason') },
  { name: 'lockdownServer', risk: 'CRITICAL', permission: 'ManageChannels', validate: need('reason') },
].map((t) => [t.name, t as ToolDef]));

// Autonomy level -> highest risk that may run without a human confirmation.
export const AUTO_RISK: Record<AutonomyLevel, Risk> = { 0: 'SAFE', 1: 'LOW', 2: 'MEDIUM', 3: 'MEDIUM', 4: 'HIGH', 5: 'HIGH' };

export interface GuildGateway {
  policy(guildId: string): Promise<GuildPolicy>;
  actorHasPermission(guildId: string, actorId: string, perm: string): Promise<boolean>;
  botHasPermission(guildId: string, perm: string): Promise<boolean>;
  botCanActOn(guildId: string, targetId: string): Promise<boolean>; // role hierarchy
  execute(req: CapabilityRequest, tool: ToolDef): Promise<unknown>;
  verify?(req: CapabilityRequest, result: unknown): Promise<boolean>;
}

export class CapabilityBroker {
  private gw: GuildGateway; private audit: AuditLog;
  constructor(gw: GuildGateway, audit: AuditLog) { this.gw = gw; this.audit = audit; }
  async submit(req: CapabilityRequest): Promise<Decision> {
    const tool = TOOLS[req.tool]; let auth = 'n/a';
    const done = (d: Decision): Decision => {
      this.audit.append({ guildId: req.guildId, actorId: req.actorId, actorType: req.actorType, action: `capability:${req.tool}`, target: req.targetId,
        capability: req.tool, authorization: auth, risk: tool?.risk ?? 'UNKNOWN', result: d.status, correlationId: req.correlationId,
        detail: d.status === 'executed' ? undefined : d.reason });
      return d;
    };
    if (!tool) return done({ status: 'denied', reason: 'unknown tool' });
    const bad = tool.validate(req.input); if (bad) return done({ status: 'denied', reason: `invalid input: ${bad}` });
    const policy = await this.gw.policy(req.guildId);
    if (policy.disabledTools.includes(tool.name)) return done({ status: 'denied', reason: 'disabled by guild policy' });
    if (req.targetId && policy.protectedIds.includes(req.targetId)) return done({ status: 'denied', reason: 'target is protected' });
    // Humans need the Discord permission; AI/system actions run as the bot and are bounded by autonomy + bot perms.
    if (req.actorType === 'user' && !(await this.gw.actorHasPermission(req.guildId, req.actorId, tool.permission))) { auth = 'actor-lacks-permission'; return done({ status: 'denied', reason: 'actor lacks permission' }); }
    if (tool.risk !== 'SAFE' && !(await this.gw.botHasPermission(req.guildId, tool.permission))) return done({ status: 'denied', reason: 'bot lacks permission' });
    if (req.targetId && tool.risk !== 'SAFE' && !(await this.gw.botCanActOn(req.guildId, req.targetId))) return done({ status: 'denied', reason: 'role hierarchy' });
    const idx = (r: Risk) => RISK_ORDER.indexOf(r);
    if (req.actorType !== 'user' && policy.autonomy === 0 && tool.risk !== 'SAFE') return done({ status: 'denied', reason: 'autonomy 0: observe only' });
    const autoOk = idx(tool.risk) <= idx(AUTO_RISK[policy.autonomy]) || (tool.risk === 'CRITICAL' && policy.autonomy === 5 && policy.allowAutoCritical);
    if (req.actorType !== 'user' && !autoOk && !req.confirmedBy) { auth = 'awaiting-confirmation'; return done({ status: 'needs_confirmation', reason: `${tool.risk} risk exceeds autonomy ${policy.autonomy}` }); }
    if (req.actorType === 'user' && tool.risk === 'CRITICAL' && !req.confirmedBy) { auth = 'awaiting-confirmation'; return done({ status: 'needs_confirmation', reason: 'CRITICAL requires confirmation' }); }
    auth = req.confirmedBy ? `confirmed:${req.confirmedBy}` : 'authorized';
    try {
      const result = await this.gw.execute(req, tool);
      if (this.gw.verify && !(await this.gw.verify(req, result))) return done({ status: 'denied', reason: 'result verification failed' });
      return done({ status: 'executed', result });
    } catch (e) { return done({ status: 'denied', reason: `execution error: ${(e as Error).message}` }); }
  }
}
