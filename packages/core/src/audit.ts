import { createHash } from 'node:crypto';
import { redact } from './redact.ts';
export interface AuditRecord {
  seq: number; timestamp: string; guildId: string; actorId: string; actorType: string; action: string;
  target?: string; capability: string; authorization: string; risk: string; result: string; correlationId: string;
  detail?: string; prevHash: string; hash: string;
}
type NewRecord = Omit<AuditRecord, 'seq' | 'timestamp' | 'prevHash' | 'hash'>;
// Hash-chained log: editing or removing any record breaks verify().
export class AuditLog {
  private chains = new Map<string, AuditRecord[]>();
  append(r: NewRecord): AuditRecord {
    const c = this.chains.get(r.guildId) ?? []; this.chains.set(r.guildId, c);
    const prevHash = c.at(-1)?.hash ?? 'GENESIS';
    const base = { ...r, detail: r.detail ? redact(r.detail) : undefined, seq: c.length, timestamp: new Date().toISOString(), prevHash };
    const rec = { ...base, hash: createHash('sha256').update(JSON.stringify(base)).digest('hex') };
    c.push(rec); return rec;
  }
  list(guildId: string) { return [...(this.chains.get(guildId) ?? [])]; }
  verify(guildId: string) {
    let prev = 'GENESIS';
    for (const r of this.chains.get(guildId) ?? []) {
      const { hash, ...base } = r;
      if (r.prevHash !== prev || createHash('sha256').update(JSON.stringify(base)).digest('hex') !== hash) return false;
      prev = hash;
    }
    return true;
  }
}
