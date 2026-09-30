import { AntiRaid } from '../../security/src/antiraid.ts';
import { AntiNuke } from '../../security/src/antinuke.ts';
import type { AdminEvent } from '../../security/src/antinuke.ts';
import type { IncidentManager, EmergencyMode } from './incident.ts';
export interface CenterDeps { incidents: IncidentManager; emergency: EmergencyMode; notify(guildId: string, text: string): Promise<void>; autoEmergency: boolean; ownerIds?: string[]; }
// Detect -> open incident -> alert staff -> (only if configured) enter emergency mode. It never punishes anyone itself.
export class SecurityCenter {
  private raid = new AntiRaid(); private nuke: AntiNuke; private d: CenterDeps;
  constructor(d: CenterDeps) { this.d = d; this.nuke = new AntiNuke(d.ownerIds ?? []); }
  async onJoin(guildId: string, userId: string, createdAt: number, now = Date.now()) {
    const r = this.raid.observeJoin(guildId, userId, createdAt, now, this.d.emergency.sensitivity(guildId, now)); if (!r) return null;
    if (this.d.incidents.active(guildId).some((i) => i.type === 'raid')) return null; // one open raid incident at a time: no alert spam
    const inc = this.d.incidents.open(guildId, 'raid', r.confidence === 'high' ? 'CRITICAL' : 'HIGH', [r.evidence]);
    await this.d.notify(guildId, `Possible raid (${r.confidence} confidence): ${r.evidence}. Incident ${inc.id} opened.`); this.d.incidents.addEvent(guildId, inc.id, 'notified', 'staff alerted');
    if (this.d.autoEmergency && inc.severity === 'CRITICAL') { const e = await this.d.emergency.activate(guildId, 'aegis', 'system', `auto: ${inc.id}`, now); if (e.ok) this.d.incidents.addEvent(guildId, inc.id, 'emergency', 'emergency mode activated by policy'); }
    return inc;
  }
  async onAdminEvent(guildId: string, actorId: string, kind: AdminEvent, now = Date.now()) {
    const n = this.nuke.observe(guildId, actorId, kind, now, this.d.emergency.sensitivity(guildId, now)); if (!n) return null;
    if (this.d.incidents.active(guildId).some((i) => i.type === 'nuke' && i.actorId === actorId)) return null;
    const inc = this.d.incidents.open(guildId, 'nuke', 'CRITICAL', [n.evidence], actorId);
    await this.d.notify(guildId, `Possible destructive activity by <@${actorId}>: ${n.evidence}. Incident ${inc.id} opened. Review permissions.`); this.d.incidents.addEvent(guildId, inc.id, 'notified', 'staff alerted');
    if (this.d.autoEmergency) { const e = await this.d.emergency.activate(guildId, 'aegis', 'system', `auto: ${inc.id}`, now); if (e.ok) this.d.incidents.addEvent(guildId, inc.id, 'emergency', 'emergency mode activated by policy'); }
    return inc;
  }
}
