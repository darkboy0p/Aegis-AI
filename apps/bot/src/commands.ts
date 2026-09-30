import type { DatabaseProvider } from '../../../packages/core/src/db.ts';
import type { TicketManager } from '../../../packages/tickets/src/tickets.ts';
import type { EmergencyMode, IncidentManager } from '../../../packages/core/src/incident.ts';
import type { ServerTwin } from '../../../packages/core/src/twin.ts';
import type { AuditLog } from '../../../packages/core/src/audit.ts';
import type { Probe } from '../../../packages/core/src/diagnostics.ts';
import { evaluate } from '../../../packages/core/src/diagnostics.ts';
import { exportGuild } from '../../../packages/core/src/backup.ts';
import { defaultPolicy } from './gateway.ts';
import type { ModerationStore } from '../../../packages/moderation/src/moderation.ts';
import { recommend } from '../../../packages/moderation/src/moderation.ts';
import type { GuildPolicy } from '../../../packages/shared/src/types.ts';

const S = 1, STR = 3, INT = 4, USER = 6; // Discord option types: subcommand, string, integer
export const COMMANDS = [
  { name: 'status', description: 'Aegis health and server summary' },
  { name: 'ticket', description: 'Tickets', options: [
    { type: S, name: 'open', description: 'Open a ticket', options: [{ type: STR, name: 'subject', description: 'What do you need?', required: true, max_length: 200 }] },
    { type: S, name: 'close', description: 'Close a ticket (staff)', options: [{ type: STR, name: 'id', description: 'Ticket id', required: true }] },
    { type: S, name: 'stats', description: 'Ticket statistics (staff)' }] },
  { name: 'emergency', description: 'Emergency mode (admin)', options: [
    { type: S, name: 'on', description: 'Enter emergency mode', options: [{ type: STR, name: 'reason', description: 'Why', required: true }] }, { type: S, name: 'off', description: 'Leave emergency mode' }] },
  { name: 'autonomy', description: 'Set autonomy level 0-5 (admin)', options: [{ type: S, name: 'set', description: 'Set level', options: [{ type: INT, name: 'level', description: '0 observe ... 5 max', required: true, min_value: 0, max_value: 5 }] }] },
  { name: 'incident', description: 'List open incidents (staff)' },
  { name: 'warn', description: 'Warn a member (staff)', options: [{ type: USER, name: 'user', description: 'Member', required: true }, { type: STR, name: 'reason', description: 'Reason', required: true, max_length: 300 }] },
  { name: 'history', description: 'Moderation history of a member (staff)', options: [{ type: USER, name: 'user', description: 'Member', required: true }] },
  { name: 'appeal', description: 'Appeals', options: [
    { type: S, name: 'open', description: 'Appeal one of your cases', options: [{ type: STR, name: 'case', description: 'Case id', required: true }, { type: STR, name: 'text', description: 'Why', required: true, max_length: 1000 }] },
    { type: S, name: 'resolve', description: 'Resolve an appeal (staff)', options: [{ type: STR, name: 'case', description: 'Case id', required: true }, { type: STR, name: 'outcome', description: 'upheld or overturned', required: true, choices: [{ name: 'upheld', value: 'upheld' }, { name: 'overturned', value: 'overturned' }] }] }] },
  { name: 'ask', description: 'Ask Aegis to check things and report (staff, read-only)', options: [{ type: STR, name: 'request', description: 'e.g. check the server and summarize tickets', required: true, max_length: 300 }] },
  { name: 'backup', description: 'Export Aegis-stored settings summary (admin)' },
];
export interface Ix { guildId: string | null; userId: string; name: string; sub?: string; str(n: string): string | null; int(n: string): number | null; isAdmin: boolean; canManageMessages: boolean; canModerate?: boolean; reply(text: string): Promise<void>; }
export interface CmdDeps { db: DatabaseProvider; tickets: TicketManager; emergency: EmergencyMode; incidents: IncidentManager; twin(guildId: string): ServerTwin; audit: AuditLog; moderation: ModerationStore; probes(): Promise<Record<string, Probe>>; ask(guildId: string, text: string): Promise<string>; defaultAutonomy: GuildPolicy['autonomy']; }
const safe = (s: string) => s.replace(/@/g, '@\u200b'); // never let user text ping anyone
export async function handleCommand(d: CmdDeps, ix: Ix): Promise<void> {
  const g = ix.guildId; if (!g) return ix.reply('Aegis commands only work inside a server.');
  const need = (ok: boolean, what: string) => { if (!ok) throw new Error(`You need ${what} to use this.`); };
  const log = (action: string, result: string, detail?: string) => d.audit.append({ guildId: g, actorId: ix.userId, actorType: 'user', action: `command:${action}`, capability: `command:${ix.name}`, authorization: 'discord-permission', risk: 'HIGH', result, correlationId: `cmd-${Date.now()}`, detail });
  try {
    if (ix.name === 'status') {
      const s = d.twin(g).snapshot(); const h = evaluate(await d.probes()); const p = (await d.db.get(g, 'guildPolicies', 'main')) as GuildPolicy | undefined;
      return ix.reply(`Aegis: ${h.state}${h.issues.length ? ` (${h.issues.join(', ')})` : ''}\nAutonomy: level ${p?.autonomy ?? d.defaultAutonomy}\nEmergency mode: ${d.emergency.isActive(g) ? 'ACTIVE' : 'off'}\nOpen incidents: ${d.incidents.active(g).length}\nKnown: ${s.roles} roles, ${s.channels} channels, ${s.bots} bots`);
    }
    if (ix.name === 'ticket') {
      if (ix.sub === 'open') { const subject = ix.str('subject')?.trim(); if (!subject) return ix.reply('Please give a subject.'); const t = await d.tickets.create(g, ix.userId, subject); return ix.reply(`Ticket ${t.id} opened as ${t.type} (${t.priority}). Staff will follow up.`); }
      need(ix.canManageMessages, 'staff permissions (Manage Messages)');
      if (ix.sub === 'close') { const t = await d.tickets.close(g, ix.str('id') ?? ''); return ix.reply(`Ticket ${t.id} closed.`); }
      if (ix.sub === 'stats') { const s = await d.tickets.stats(g); return ix.reply(`Tickets: ${s.total} total, ${s.open} open. ${Object.entries(s.byType).map(([k, v]) => `${k}: ${v}`).join(', ')}`); }
    }
    if (ix.name === 'emergency') {
      need(ix.isAdmin, 'Administrator');
      if (ix.sub === 'on') { const r = await d.emergency.activate(g, ix.userId, 'user', safe(ix.str('reason') ?? 'manual'));
        return ix.reply(r.ok ? 'Emergency mode ON. Thresholds tightened; it expires automatically after 30 minutes unless you turn it off sooner.' : 'Not authorized.'); }
      return ix.reply((await d.emergency.deactivate(g, ix.userId)) ? 'Emergency mode OFF.' : 'Not authorized.');
    }
    if (ix.name === 'autonomy') {
      need(ix.isAdmin, 'Administrator'); const lvl = ix.int('level'); if (lvl === null || !Number.isInteger(lvl) || lvl < 0 || lvl > 5) return ix.reply('Level must be 0-5.');
      const prev = ((await d.db.get(g, 'guildPolicies', 'main')) as GuildPolicy | undefined) ?? defaultPolicy(d.defaultAutonomy);
      await d.db.set(g, 'guildPolicies', 'main', { ...prev, autonomy: lvl }); log('autonomy', 'executed', `level ${prev.autonomy} -> ${lvl}`);
      return ix.reply(`Autonomy set to level ${lvl}. Auto-approval of CRITICAL actions stays off; that can only be changed in stored policy, not from chat.`);
    }
    if (ix.name === 'warn') {
      need(!!ix.canModerate, 'Moderate Members'); const u = ix.str('user'); const r = ix.str('reason')?.trim(); if (!u || !r) return ix.reply('User and reason are required.');
      const c = await d.moderation.add(g, { userId: u, action: 'WARN', moderatorId: ix.userId, moderatorType: 'user', reason: r, source: 'manual' }); const n = await d.moderation.activeWarnings(g, u); const rec = recommend(n);
      log('warn', 'executed', c.id); return ix.reply(`Case ${c.id}: warning recorded. ${rec.explanation} Recommendation only; nothing was applied automatically.`);
    }
    if (ix.name === 'history') {
      need(!!ix.canModerate, 'Moderate Members'); const u = ix.str('user') ?? ''; const h = await d.moderation.history(g, u);
      return ix.reply(h.length ? h.slice(0, 10).map((k) => `${k.id} ${k.action}${k.status === 'overturned' ? ' (overturned)' : ''} by ${k.moderatorType === 'system' ? k.source : 'staff'}: ${safe(k.reason)}`).join('\n') : 'No cases on record.');
    }
    if (ix.name === 'appeal') {
      if (ix.sub === 'open') { await d.moderation.appeal(g, ix.str('case') ?? '', ix.userId, ix.str('text') ?? ''); return ix.reply('Appeal submitted. Staff will review it.'); }
      need(!!ix.canModerate, 'Moderate Members'); const o = ix.str('outcome'); if (o !== 'upheld' && o !== 'overturned') return ix.reply('Outcome must be upheld or overturned.');
      const k = await d.moderation.resolveAppeal(g, ix.str('case') ?? '', ix.userId, o); log('appeal', 'executed', `${k.id} ${o}`); return ix.reply(`Appeal on case ${k.id} ${o}.${o === 'overturned' ? ' The case no longer counts toward escalation.' : ''}`);
    }
    if (ix.name === 'ask') { need(ix.canManageMessages, 'staff permissions (Manage Messages)'); const q = ix.str('request')?.trim(); if (!q) return ix.reply('Tell me what to check.'); return ix.reply(safe(await d.ask(g, q))); }
    if (ix.name === 'incident') { need(ix.canManageMessages, 'staff permissions'); const l = d.incidents.active(g); return ix.reply(l.length ? l.map((i) => `${i.id} ${i.type} ${i.severity} (${i.evidence[0] ?? ''})`).join('\n') : 'No open incidents.'); }
    if (ix.name === 'backup') { need(ix.isAdmin, 'Administrator'); const b = await exportGuild(d.db, g); log('backup', 'executed'); return ix.reply(`Backup built ${b.exportedAt}: ${Object.entries(b.data).map(([k, v]) => `${k}=${v.length}`).join(', ')}. (File delivery and restore are not implemented yet.)`); }
    return ix.reply('Unknown command.');
  } catch (e) { return ix.reply(safe((e as Error).message).slice(0, 300)); }
}
