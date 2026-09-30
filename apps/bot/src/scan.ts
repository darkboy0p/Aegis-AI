import type { ServerTwin } from '../../../packages/core/src/twin.ts';
export interface ScanGuild { id: string; name: string; memberCount: number; hasSystemChannel: boolean; roles: { id: string; name: string; position: number; admin: boolean; managed: boolean }[];
  channels: { id: string; name: string; type: string; parentId?: string }[]; botIds: string[]; botHas(p: string): boolean; }
// Read-only discovery. Reports only what Discord returned; other bots' functionality is not discoverable, so only their presence is listed.
export function scanGuild(g: ScanGuild, twin: ServerTwin): { report: string; warnings: string[] } {
  g.roles.forEach((r) => twin.apply({ kind: 'roleCreate', ...r })); g.channels.forEach((c) => twin.apply({ kind: 'channelCreate', ...c }));
  g.botIds.forEach((id) => twin.apply({ kind: 'memberJoin', id, bot: true })); const s = twin.snapshot();
  const warnings: string[] = [];
  for (const p of ['ManageMessages', 'ModerateMembers', 'ViewAuditLog']) if (!g.botHas(p)) warnings.push(`Aegis lacks ${p}: related features are limited`);
  if (!g.hasSystemChannel) warnings.push('No system channel set: staff alerts cannot be posted');
  if (s.adminRoles.length > 3) warnings.push(`${s.adminRoles.length} roles have Administrator (review recommended)`);
  return { report: `Scan of ${g.name}: ${g.memberCount} members, ${s.roles} roles, ${s.channels} channels, ${g.botIds.length} bots (function of other bots not inspected).${warnings.length ? '\nWarnings:\n- ' + warnings.join('\n- ') : '\nNo warnings.'}`, warnings };
}
