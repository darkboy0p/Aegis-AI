export interface SpamConfig { windowMs: number; maxMessages: number; maxRepeats: number; maxMentions: number; }
export interface Detection { type: string; userId: string; confidence: 'low' | 'medium' | 'high'; evidence: string; }
export class AntiSpam {
  private h = new Map<string, { t: number; c: string }[]>();
  private cfg: SpamConfig;
  constructor(cfg: SpamConfig = { windowMs: 10_000, maxMessages: 8, maxRepeats: 4, maxMentions: 6 }) { this.cfg = cfg; }
  observe(guildId: string, userId: string, content: string, now = Date.now(), mentions = 0): Detection | null {
    const k = `${guildId}:${userId}`;
    const w = (this.h.get(k) ?? []).filter((x) => now - x.t < this.cfg.windowMs); w.push({ t: now, c: content.trim().toLowerCase() }); this.h.set(k, w);
    const rep = w.filter((x) => x.c === w.at(-1)!.c).length;
    if (mentions >= this.cfg.maxMentions) return { type: 'mention_spam', userId, confidence: 'high', evidence: `${mentions} mentions in one message` };
    if (rep >= this.cfg.maxRepeats) return { type: 'repeat_spam', userId, confidence: 'high', evidence: `${rep} identical messages within ${this.cfg.windowMs}ms` };
    if (w.length >= this.cfg.maxMessages) return { type: 'burst_spam', userId, confidence: 'medium', evidence: `${w.length} messages within ${this.cfg.windowMs}ms` };
    return null;
  }
}
