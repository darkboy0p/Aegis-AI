const HOUR = 3_600_000;
export class Metrics {
  private m = new Map<string, Map<string, number>>();
  inc(guildId: string, name: string, n = 1, now = Date.now()) { const k = `${guildId}|${name}`; const b = this.m.get(k) ?? new Map<string, number>(); const h = String(Math.floor(now / HOUR)); b.set(h, (b.get(h) ?? 0) + n); this.m.set(k, b); }
  total(guildId: string, name: string, sinceMs: number, now = Date.now()) { let t = 0; for (const [h, v] of this.m.get(`${guildId}|${name}`) ?? []) if (Number(h) * HOUR >= now - sinceMs - HOUR + 1) t += v; return t; }
  report(guildId: string, title: string, names: string[], sinceMs: number, now = Date.now()) {
    return [`${title} (last ${Math.round(sinceMs / HOUR)}h)`, ...names.map((n) => `${n}: ${this.total(guildId, n, sinceMs, now)}`)].join('\n');
  }
}
