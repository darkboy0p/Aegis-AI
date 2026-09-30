import type { GuildGateway, ToolDef } from '../../../packages/permissions/src/broker.ts';
import type { CapabilityRequest, GuildPolicy } from '../../../packages/shared/src/types.ts';
import type { DatabaseProvider } from '../../../packages/core/src/db.ts';
// Structural subset of discord.js so this file is testable and does not import it.
export interface DjsMember { manageable: boolean; permissions: { has(p: string): boolean }; timeout(ms: number, reason?: string): Promise<unknown>; kick(reason?: string): Promise<unknown>; }
export interface DjsGuild { name: string; memberCount: number; members: { me: { permissions: { has(p: string): boolean } } | null; fetch(id: string): Promise<DjsMember>; ban(id: string, o: { reason?: string }): Promise<unknown> };
  channels: { fetch(id: string): Promise<{ send?(c: string): Promise<unknown>; messages?: { delete(id: string): Promise<unknown> } } | null> }; }
export interface DjsClient { guilds: { fetch(id: string): Promise<DjsGuild> }; }
export function defaultPolicy(autonomy: GuildPolicy['autonomy']): GuildPolicy { return { autonomy, disabledTools: [], protectedIds: [], allowAutoCritical: false }; }
const str = (i: unknown, k: string) => String((i as Record<string, unknown>)[k]);
export class DiscordGateway implements GuildGateway {
  private c: DjsClient; private db: DatabaseProvider; private dflt: GuildPolicy['autonomy'];
  constructor(c: DjsClient, db: DatabaseProvider, dflt: GuildPolicy['autonomy']) { this.c = c; this.db = db; this.dflt = dflt; }
  async policy(g: string) { return ((await this.db.get(g, 'guildPolicies', 'main')) as GuildPolicy | undefined) ?? defaultPolicy(this.dflt); }
  async actorHasPermission(g: string, a: string, p: string) { try { return (await (await this.c.guilds.fetch(g)).members.fetch(a)).permissions.has(p); } catch { return false; } }
  async botHasPermission(g: string, p: string) { try { return (await this.c.guilds.fetch(g)).members.me?.permissions.has(p) ?? false; } catch { return false; } }
  async botCanActOn(g: string, t: string) { try { return (await (await this.c.guilds.fetch(g)).members.fetch(t)).manageable; } catch { return false; } } // discord.js applies role hierarchy + owner rules
  async execute(r: CapabilityRequest, tool: ToolDef): Promise<unknown> {
    const g = await this.c.guilds.fetch(r.guildId);
    switch (tool.name) {
      case 'getServerStatus': return { name: g.name, memberCount: g.memberCount };
      case 'sendMessage': { const ch = await g.channels.fetch(str(r.input, 'channelId')); if (!ch?.send) throw new Error('channel not sendable'); await ch.send(str(r.input, 'content').slice(0, 1900)); return 'sent'; }
      case 'deleteMessage': { const ch = await g.channels.fetch(str(r.input, 'channelId')); if (!ch?.messages) throw new Error('no messages'); await ch.messages.delete(str(r.input, 'messageId')); return 'deleted'; }
      case 'timeoutMember': await (await g.members.fetch(str(r.input, 'memberId'))).timeout(10 * 60_000, str(r.input, 'reason')); return 'timed out 10m';
      case 'kickMember': await (await g.members.fetch(str(r.input, 'memberId'))).kick(str(r.input, 'reason')); return 'kicked';
      case 'banMember': await g.members.ban(str(r.input, 'memberId'), { reason: str(r.input, 'reason') }); return 'banned';
      default: throw new Error(`${tool.name} is not implemented yet`); // lockdownServer, generateReport
    }
  }
}
