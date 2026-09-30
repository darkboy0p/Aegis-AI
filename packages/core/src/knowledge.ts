export type Certainty = 'KNOWN' | 'INFERRED' | 'UNKNOWN' | 'STALE';
export interface Fact { key: string; value: string; certainty: Certainty; source: string; updatedAt: number; confirmedBy?: string; }
// Inferences stay INFERRED until a human confirms; old facts decay to STALE. Lookups for missing keys say UNKNOWN.
export class KnowledgeBase {
  private f = new Map<string, Map<string, Fact>>();
  private g(guildId: string) { if (!this.f.has(guildId)) this.f.set(guildId, new Map()); return this.f.get(guildId)!; }
  learn(guildId: string, key: string, value: string, source: string, now = Date.now()) { const prev = this.g(guildId).get(key); const same = prev?.value === value; this.g(guildId).set(key, { key, value, certainty: same && prev?.confirmedBy ? 'KNOWN' : 'INFERRED', source, updatedAt: now, confirmedBy: same ? prev?.confirmedBy : undefined }); }
  setKnown(guildId: string, key: string, value: string, staffId: string, now = Date.now()) { this.g(guildId).set(key, { key, value, certainty: 'KNOWN', source: 'staff', updatedAt: now, confirmedBy: staffId }); }
  confirm(guildId: string, key: string, staffId: string, now = Date.now()) { const x = this.g(guildId).get(key); if (!x) return false; x.certainty = 'KNOWN'; x.confirmedBy = staffId; x.updatedAt = now; return true; }
  get(guildId: string, key: string): Fact { return this.g(guildId).get(key) ?? { key, value: '', certainty: 'UNKNOWN', source: 'none', updatedAt: 0 }; }
  decay(guildId: string, maxAgeMs: number, now = Date.now()) { let n = 0; for (const x of this.g(guildId).values()) if (x.certainty !== 'STALE' && now - x.updatedAt > maxAgeMs) { x.certainty = 'STALE'; n++; } return n; }
}
