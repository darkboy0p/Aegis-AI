import type { DatabaseProvider } from '../../core/src/db.ts';
export type Tier = 'working' | 'conversation' | 'user' | 'server' | 'incident' | 'task' | 'knowledge' | 'evolution';
export interface MemoryEntry { id: string; guildId: string; tier: Tier; text: string; importance: number; source: string; createdAt: number; expiresAt?: number; }
const H = 3_600_000, D = 24 * H;
export const DEFAULT_RETENTION: Partial<Record<Tier, number>> = { working: H, conversation: D, user: 90 * D, server: 365 * D, incident: 180 * D, task: 30 * D };
// Guild-isolated, expiring, ranked memory. Nothing is kept forever unless the retention policy says so (knowledge/evolution).
export class MemoryStore {
  private db: DatabaseProvider; private ret: Partial<Record<Tier, number>>; private n = 0;
  constructor(db: DatabaseProvider, retention: Partial<Record<Tier, number>> = DEFAULT_RETENTION) { this.db = db; this.ret = retention; }
  async add(guildId: string, tier: Tier, text: string, o: { importance?: number; source: string; now?: number }): Promise<MemoryEntry> {
    const now = o.now ?? Date.now(); const ttl = this.ret[tier];
    const e: MemoryEntry = { id: `m${now}-${++this.n}`, guildId, tier, text, importance: Math.min(1, Math.max(0, o.importance ?? 0.5)), source: o.source, createdAt: now, ...(ttl ? { expiresAt: now + ttl } : {}) };
    await this.db.set(guildId, 'guildMemory', e.id, e); return e;
  }
  private async all(guildId: string) { return (await this.db.list(guildId, 'guildMemory')) as MemoryEntry[]; }
  async retrieve(guildId: string, query: string, o: { tier?: Tier; limit?: number; now?: number } = {}): Promise<MemoryEntry[]> {
    const now = o.now ?? Date.now(); const words = query.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
    return (await this.all(guildId)).filter((e) => e.guildId === guildId && (!e.expiresAt || e.expiresAt > now) && (!o.tier || e.tier === o.tier))
      .map((e) => ({ e, s: words.filter((w) => e.text.toLowerCase().includes(w)).length * (0.5 + e.importance) + Math.max(0, 1 - (now - e.createdAt) / (30 * D)) * 0.25 }))
      .filter((x) => x.s > 0.3 && words.some((w) => x.e.text.toLowerCase().includes(w))).sort((a, b) => b.s - a.s).slice(0, o.limit ?? 5).map((x) => x.e);
  }
  async purgeExpired(guildId: string, now = Date.now()) { let n = 0; for (const e of await this.all(guildId)) if (e.expiresAt && e.expiresAt <= now) { await this.db.delete(guildId, 'guildMemory', e.id); n++; } return n; }
  async delete(guildId: string, id: string) { await this.db.delete(guildId, 'guildMemory', id); }
  async forgetUser(guildId: string, userId: string) { let n = 0; for (const e of await this.all(guildId)) if (e.source === `user:${userId}`) { await this.db.delete(guildId, 'guildMemory', e.id); n++; } return n; }
}
