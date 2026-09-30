import type { Metrics } from './metrics.ts';
import type { IncidentManager } from '../../core/src/incident.ts';
export function dailyReport(g: string, m: Metrics, inc: IncidentManager, tickets: { total: number; open: number }, now = Date.now()) {
  const day = 24 * 3_600_000; const opened = inc.list(g).filter((i) => now - Date.parse(i.openedAt) < day);
  return [m.report(g, 'Aegis daily report', ['messages_seen', 'spam_detections', 'phishing_removed', 'ai_requests', 'commands'], day, now), `Incidents opened: ${opened.length} (${inc.active(g).length} still open)`, `Tickets: ${tickets.total} total, ${tickets.open} open`].join('\n');
}
