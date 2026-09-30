import type { AuditLog } from './audit.ts';
export interface TimelineEntry { at: string; kind: string; text: string; }
export interface Incident { id: string; guildId: string; type: string; severity: 'MEDIUM' | 'HIGH' | 'CRITICAL'; status: 'open' | 'closed'; openedAt: string; closedAt?: string; actorId?: string; evidence: string[]; timeline: TimelineEntry[]; }
export class IncidentManager {
  private m = new Map<string, Incident[]>(); private n = 0;
  open(guildId: string, type: string, severity: Incident['severity'], evidence: string[], actorId?: string): Incident {
    const now = new Date().toISOString();
    const i: Incident = { id: `inc-${++this.n}`, guildId, type, severity, status: 'open', openedAt: now, actorId, evidence: [...evidence], timeline: [{ at: now, kind: 'detected', text: `${type} detected` }] };
    this.m.set(guildId, [...(this.m.get(guildId) ?? []), i]); return i;
  }
  private find(guildId: string, id: string) { const i = this.m.get(guildId)?.find((x) => x.id === id); if (!i) throw new Error('incident not found in this guild'); return i; }
  addEvent(guildId: string, id: string, kind: string, text: string) { this.find(guildId, id).timeline.push({ at: new Date().toISOString(), kind, text }); }
  close(guildId: string, id: string) { const i = this.find(guildId, id); i.status = 'closed'; i.closedAt = new Date().toISOString(); i.timeline.push({ at: i.closedAt, kind: 'closed', text: 'incident closed' }); }
  list(guildId: string) { return [...(this.m.get(guildId) ?? [])]; }
  active(guildId: string) { return this.list(guildId).filter((i) => i.status === 'open'); }
  report(guildId: string, id: string): string {
    const i = this.find(guildId, id);
    return [`Incident ${i.id} (${i.type}, ${i.severity}, ${i.status})`, i.actorId ? `Actor: ${i.actorId}` : 'Actor: unidentified', 'Evidence:', ...i.evidence.map((e) => `- ${e}`), 'Timeline:', ...i.timeline.map((t) => `${t.at} ${t.kind}: ${t.text}`)].join('\n');
  }
}
export class EmergencyMode {
  private s = new Map<string, { until: number; reason: string; by: string }>(); private audit: AuditLog; private can: (g: string, a: string) => Promise<boolean>; private ttl: number;
  constructor(audit: AuditLog, canManage: (guildId: string, actorId: string) => Promise<boolean>, ttlMs = 30 * 60_000) { this.audit = audit; this.can = canManage; this.ttl = ttlMs; }
  private log(g: string, a: string, t: 'user' | 'system', action: string, result: string, reason: string) {
    this.audit.append({ guildId: g, actorId: a, actorType: t, action, capability: 'emergency', authorization: t === 'user' ? 'admin-check' : 'auto-policy', risk: 'CRITICAL', result, correlationId: `em-${Date.now()}`, detail: reason });
  }
  async activate(g: string, actorId: string, actorType: 'user' | 'system', reason: string, now = Date.now()) {
    if (actorType === 'user' && !(await this.can(g, actorId))) { this.log(g, actorId, actorType, 'emergency:activate', 'denied', reason); return { ok: false as const, reason: 'not authorized' }; }
    this.s.set(g, { until: now + this.ttl, reason, by: actorId }); this.log(g, actorId, actorType, 'emergency:activate', 'executed', reason); return { ok: true as const, until: now + this.ttl };
  }
  async deactivate(g: string, actorId: string) {
    if (!(await this.can(g, actorId))) { this.log(g, actorId, 'user', 'emergency:deactivate', 'denied', ''); return false; }
    this.s.delete(g); this.log(g, actorId, 'user', 'emergency:deactivate', 'executed', ''); return true;
  }
  isActive(g: string, now = Date.now()) { const x = this.s.get(g); if (!x) return false; if (now >= x.until) { this.s.delete(g); this.log(g, 'aegis', 'system', 'emergency:expire', 'executed', 'ttl elapsed'); return false; } return true; }
  sensitivity(g: string, now = Date.now()) { return this.isActive(g, now) ? 0.5 : 1; } // lower thresholds while active
}
