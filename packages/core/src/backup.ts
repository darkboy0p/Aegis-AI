import type { DatabaseProvider } from './db.ts';
export const BACKUP_COLLECTIONS = ['guildSettings', 'guildPolicies', 'guildKnowledge', 'guildTickets', 'guildIncidents'];
export interface Backup { version: 1; guildId: string; exportedAt: string; data: Record<string, { id: string; value: unknown }[]>; }
// Only data Aegis stored can be restored. Deleted Discord channels/messages are NOT recoverable from this.
export async function exportGuild(db: DatabaseProvider, guildId: string, collections = BACKUP_COLLECTIONS): Promise<Backup> {
  const data: Backup['data'] = {};
  for (const c of collections) data[c] = (await db.list(guildId, c)).map((v, i) => ({ id: String((v as { id?: string })?.id ?? i), value: v }));
  return { version: 1, guildId, exportedAt: new Date().toISOString(), data };
}
export async function importGuild(db: DatabaseProvider, guildId: string, b: Backup) {
  if (b.version !== 1 || b.guildId !== guildId) throw new Error('backup belongs to a different guild or version'); let n = 0;
  for (const [c, rows] of Object.entries(b.data)) { if (!BACKUP_COLLECTIONS.includes(c)) throw new Error(`collection not restorable: ${c}`); for (const r of rows) { await db.set(guildId, c, r.id, r.value); n++; } }
  return n;
}
