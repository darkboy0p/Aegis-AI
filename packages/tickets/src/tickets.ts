import type { DatabaseProvider } from '../../core/src/db.ts';
export type TicketType = 'Support' | 'Report' | 'Ban Appeal' | 'Partnership' | 'Purchase' | 'Bug' | 'Staff Application' | 'Security' | 'Other';
export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
const RULES: [TicketType, RegExp][] = [['Security', /(hacked|compromised|leak|phish|raid|token stolen|exploit)/i], ['Ban Appeal', /(unban|appeal|banned)/i], ['Staff Application', /(apply|application).{0,20}(staff|mod)/i],
  ['Partnership', /(partner|collab|sponsor)/i], ['Purchase', /(buy|purchase|refund|payment|order)/i], ['Bug', /(bug|crash|error|broken|glitch)/i], ['Report', /(report|harass|scam|abuse|spam)/i], ['Support', /(help|how do i|can't|cannot|issue|problem)/i]];
export function classify(text: string): { type: TicketType; priority: Priority } {
  const type = RULES.find(([, r]) => r.test(text))?.[0] ?? 'Other';
  const priority: Priority = type === 'Security' ? 'URGENT' : /(urgent|asap|emergency)/i.test(text) || type === 'Report' ? 'HIGH' : type === 'Other' || type === 'Partnership' ? 'LOW' : 'NORMAL';
  return { type, priority };
}
export interface Ticket { id: string; guildId: string; userId: string; type: TicketType; priority: Priority; status: 'open' | 'closed'; subject: string; assignee?: string; notes: { at: number; by: string; text: string }[]; createdAt: number; updatedAt: number; reopened: number; }
export class TicketManager {
  private db: DatabaseProvider; private n = 0;
  constructor(db: DatabaseProvider) { this.db = db; }
  private async get(g: string, id: string) { const t = (await this.db.get(g, 'guildTickets', id)) as Ticket | undefined; if (!t) throw new Error('ticket not found in this guild'); return t; }
  private async put(t: Ticket, now: number) { t.updatedAt = now; await this.db.set(t.guildId, 'guildTickets', t.id, t); return t; }
  async create(guildId: string, userId: string, subject: string, now = Date.now()) {
    const c = classify(subject); const t: Ticket = { id: `t${now}-${++this.n}`, guildId, userId, ...c, status: 'open', subject: subject.slice(0, 200), notes: [], createdAt: now, updatedAt: now, reopened: 0 };
    return this.put(t, now);
  }
  async assign(g: string, id: string, staffId: string, now = Date.now()) { const t = await this.get(g, id); t.assignee = staffId; return this.put(t, now); }
  async note(g: string, id: string, by: string, text: string, now = Date.now()) { const t = await this.get(g, id); t.notes.push({ at: now, by, text }); return this.put(t, now); }
  async close(g: string, id: string, now = Date.now()) { const t = await this.get(g, id); t.status = 'closed'; return this.put(t, now); }
  async reopen(g: string, id: string, now = Date.now()) { const t = await this.get(g, id); t.status = 'open'; t.reopened++; if (t.reopened >= 2 && t.priority !== 'URGENT') t.priority = 'HIGH'; return this.put(t, now); } // repeat reopen escalates
  async inactive(g: string, olderThanMs: number, now = Date.now()) { return ((await this.db.list(g, 'guildTickets')) as Ticket[]).filter((t) => t.status === 'open' && now - t.updatedAt >= olderThanMs); }
  async stats(g: string) { const l = (await this.db.list(g, 'guildTickets')) as Ticket[]; const byType: Record<string, number> = {}; l.forEach((t) => { byType[t.type] = (byType[t.type] ?? 0) + 1; }); return { total: l.length, open: l.filter((t) => t.status === 'open').length, byType }; }
}
