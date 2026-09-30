import type { DatabaseProvider } from '../../core/src/db.ts';
export type ModAction = 'WARN' | 'DELETE' | 'TIMEOUT' | 'KICK' | 'BAN';
export interface Appeal { status: 'pending' | 'upheld' | 'overturned'; text: string; at: number; resolvedBy?: string; }
export interface ModCase { id: string; guildId: string; userId: string; action: ModAction; moderatorId: string; moderatorType: 'user' | 'system'; reason: string; evidence: string[]; source: string; createdAt: number; status: 'active' | 'overturned'; appeal?: Appeal; }
export const DAY = 86_400_000;
export const DEFAULT_LADDER: { at: number; action: ModAction }[] = [{ at: 1, action: 'WARN' }, { at: 3, action: 'TIMEOUT' }, { at: 5, action: 'KICK' }];
// Recommends only. BAN is never suggested automatically: it always needs a human decision.
export function recommend(activeWarnings: number, ladder = DEFAULT_LADDER): { action: ModAction | 'NONE'; explanation: string } {
  const step = [...ladder].sort((a, b) => b.at - a.at).find((s) => activeWarnings >= s.at);
  if (!step) return { action: 'NONE', explanation: 'No active warnings.' };
  return { action: step.action, explanation: `${activeWarnings} active warning(s) meets escalation step "${step.action}" (at ${step.at}). Ban decisions are made by staff only.` };
}
export class ModerationStore {
  private db: DatabaseProvider; private n = 0;
  constructor(db: DatabaseProvider) { this.db = db; }
  async add(guildId: string, c: { userId: string; action: ModAction; moderatorId: string; moderatorType: 'user' | 'system'; reason: string; evidence?: string[]; source: string }, now = Date.now()): Promise<ModCase> {
    const evidence = c.evidence ?? []; if (c.moderatorType === 'system' && evidence.length === 0) throw new Error('automated actions must record evidence');
    const k: ModCase = { id: `${now}-${++this.n}`, guildId, userId: c.userId, action: c.action, moderatorId: c.moderatorId, moderatorType: c.moderatorType, reason: c.reason.trim().slice(0, 300), evidence, source: c.source, createdAt: now, status: 'active' };
    await this.db.set(guildId, 'guildModeration', k.id, k); return k;
  }
  private async all(g: string) { return (await this.db.list(g, 'guildModeration')) as ModCase[]; }
  private async get(g: string, id: string) { const k = (await this.db.get(g, 'guildModeration', id)) as ModCase | undefined; if (!k) throw new Error('case not found in this guild'); return k; }
  async history(g: string, userId: string) { return (await this.all(g)).filter((k) => k.userId === userId).sort((a, b) => b.createdAt - a.createdAt); }
  async recent(g: string, limit = 50) { return (await this.all(g)).sort((a, b) => b.createdAt - a.createdAt).slice(0, limit); }
  async activeWarnings(g: string, userId: string, now = Date.now(), decayMs = 30 * DAY) { return (await this.history(g, userId)).filter((k) => k.action === 'WARN' && k.status === 'active' && now - k.createdAt < decayMs).length; }
  async appeal(g: string, caseId: string, userId: string, text: string, now = Date.now()) {
    const k = await this.get(g, caseId); if (k.userId !== userId) throw new Error('you can only appeal your own cases'); if (k.appeal) throw new Error('this case already has an appeal');
    k.appeal = { status: 'pending', text: text.trim().slice(0, 1000), at: now }; await this.db.set(g, 'guildModeration', k.id, k); return k;
  }
  async resolveAppeal(g: string, caseId: string, staffId: string, outcome: 'upheld' | 'overturned') {
    const k = await this.get(g, caseId); if (!k.appeal || k.appeal.status !== 'pending') throw new Error('no pending appeal on this case');
    k.appeal.status = outcome; k.appeal.resolvedBy = staffId; if (outcome === 'overturned') k.status = 'overturned'; await this.db.set(g, 'guildModeration', k.id, k); return k;
  }
}
