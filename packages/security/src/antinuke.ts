export type AdminEvent = 'channelDelete' | 'roleDelete' | 'ban' | 'kick' | 'webhookCreate' | 'permissionChange';
export interface NukeDetection { type: 'nuke'; kind: AdminEvent; actorId: string; confidence: 'high'; evidence: string; }
const LIMITS: Record<AdminEvent, number> = { channelDelete: 3, roleDelete: 3, ban: 5, kick: 5, webhookCreate: 4, permissionChange: 5 };
// Counts destructive admin events per actor. Trusted actors (owner, Aegis itself) are never flagged.
export class AntiNuke {
  private h = new Map<string, number[]>(); private trusted: Set<string>; private windowMs: number;
  constructor(trusted: string[] = [], windowMs = 10_000) { this.trusted = new Set(trusted); this.windowMs = windowMs; }
  observe(guildId: string, actorId: string, kind: AdminEvent, now = Date.now(), sensitivity = 1): NukeDetection | null {
    if (this.trusted.has(actorId)) return null;
    const k = `${guildId}:${actorId}:${kind}`; const w = (this.h.get(k) ?? []).filter((t) => now - t < this.windowMs); w.push(now); this.h.set(k, w);
    return w.length >= Math.max(2, Math.ceil(LIMITS[kind] * sensitivity)) ? { type: 'nuke', kind, actorId, confidence: 'high', evidence: `${w.length} ${kind} events by one actor within ${this.windowMs / 1000}s` } : null;
  }
}
