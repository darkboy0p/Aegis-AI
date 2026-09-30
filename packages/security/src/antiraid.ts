export interface RaidConfig { windowMs: number; maxJoins: number; youngAccountMs: number; minYoungRatio: number; }
export interface RaidDetection { type: 'raid'; confidence: 'medium' | 'high'; evidence: string; userIds: string[]; }
// Flags a join burst; confidence is high only when most joiners are also very new accounts.
export class AntiRaid {
  private j = new Map<string, { t: number; u: string; young: boolean }[]>(); private cfg: RaidConfig;
  constructor(cfg: RaidConfig = { windowMs: 30_000, maxJoins: 10, youngAccountMs: 7 * 86_400_000, minYoungRatio: 0.6 }) { this.cfg = cfg; }
  observeJoin(guildId: string, userId: string, accountCreatedAt: number, now = Date.now(), sensitivity = 1): RaidDetection | null {
    const w = (this.j.get(guildId) ?? []).filter((x) => now - x.t < this.cfg.windowMs); w.push({ t: now, u: userId, young: now - accountCreatedAt < this.cfg.youngAccountMs }); this.j.set(guildId, w);
    if (w.length < Math.ceil(this.cfg.maxJoins * sensitivity)) return null;
    const young = w.filter((x) => x.young).length; const high = young / w.length >= this.cfg.minYoungRatio;
    return { type: 'raid', confidence: high ? 'high' : 'medium', userIds: w.map((x) => x.u), evidence: `${w.length} joins within ${this.cfg.windowMs / 1000}s, ${young} accounts younger than 7 days` };
  }
}
