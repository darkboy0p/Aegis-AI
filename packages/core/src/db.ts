export interface DatabaseProvider {
  get(guildId: string, col: string, id: string): Promise<unknown | undefined>;
  set(guildId: string, col: string, id: string, v: unknown): Promise<void>;
  list(guildId: string, col: string): Promise<unknown[]>;
  delete(guildId: string, col: string, id: string): Promise<void>;
  health(): Promise<boolean>;
}
// Every path is rooted at guilds/{guildId}; there is no API to read across guilds.
export class MemoryProvider implements DatabaseProvider {
  private m = new Map<string, Map<string, unknown>>();
  private k(g: string, c: string) {
    if (!g || g.includes('/') || c.includes('/')) throw new Error('invalid guild/collection');
    return `guilds/${g}/${c}`;
  }
  async get(g: string, c: string, id: string) { return structuredClone(this.m.get(this.k(g, c))?.get(id)); }
  async set(g: string, c: string, id: string, v: unknown) {
    const key = this.k(g, c); if (!this.m.has(key)) this.m.set(key, new Map()); this.m.get(key)!.set(id, structuredClone(v));
  }
  async list(g: string, c: string) { return [...(this.m.get(this.k(g, c))?.values() ?? [])].map((v) => structuredClone(v)); }
  async delete(g: string, c: string, id: string) { this.m.get(this.k(g, c))?.delete(id); }
  async health() { return true; }
}
