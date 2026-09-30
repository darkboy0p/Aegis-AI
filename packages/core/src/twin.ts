export type TwinEvent =
  | { kind: 'roleCreate' | 'roleUpdate'; id: string; name: string; position: number; admin: boolean; managed?: boolean }
  | { kind: 'roleDelete' | 'channelDelete'; id: string }
  | { kind: 'channelCreate' | 'channelUpdate'; id: string; name: string; type: string; parentId?: string }
  | { kind: 'memberJoin'; id: string; bot: boolean } | { kind: 'memberLeave'; id: string };
export interface TwinAlert { type: 'admin_granted' | 'protected_role_change'; roleId: string; text: string; }
// Event-driven mirror of one guild. Only holds what the events told it; it does not invent data.
export class ServerTwin {
  roles = new Map<string, { name: string; position: number; admin: boolean; managed: boolean }>(); channels = new Map<string, { name: string; type: string; parentId?: string }>();
  bots = new Set<string>(); memberCount = 0; lastEventAt = 0; readonly guildId: string; private protectedRoles: Set<string>;
  constructor(guildId: string, protectedRoleIds: string[] = []) { this.guildId = guildId; this.protectedRoles = new Set(protectedRoleIds); }
  apply(e: TwinEvent, now = Date.now()): TwinAlert[] {
    this.lastEventAt = now; const alerts: TwinAlert[] = [];
    switch (e.kind) {
      case 'roleCreate': case 'roleUpdate': {
        const old = this.roles.get(e.id);
        if (e.admin && !old?.admin) alerts.push({ type: 'admin_granted', roleId: e.id, text: `Role "${e.name}" now has Administrator` });
        if (old && this.protectedRoles.has(e.id)) alerts.push({ type: 'protected_role_change', roleId: e.id, text: `Protected role "${e.name}" was modified` });
        this.roles.set(e.id, { name: e.name, position: e.position, admin: e.admin, managed: !!e.managed }); break; }
      case 'roleDelete': this.roles.delete(e.id); break;
      case 'channelCreate': case 'channelUpdate': this.channels.set(e.id, { name: e.name, type: e.type, parentId: e.parentId }); break;
      case 'channelDelete': this.channels.delete(e.id); break;
      case 'memberJoin': this.memberCount++; if (e.bot) this.bots.add(e.id); break;
      case 'memberLeave': this.memberCount = Math.max(0, this.memberCount - 1); this.bots.delete(e.id); break;
    }
    return alerts;
  }
  snapshot() { return { guildId: this.guildId, roles: this.roles.size, channels: this.channels.size, bots: this.bots.size, memberCount: this.memberCount, adminRoles: [...this.roles].filter(([, r]) => r.admin).map(([id]) => id), lastEventAt: this.lastEventAt }; }
}
