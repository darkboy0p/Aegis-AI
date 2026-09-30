import { timingSafeEqual } from 'node:crypto';
import type { AuditLog } from '../../../packages/core/src/audit.ts';
export type Health = 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'UNKNOWN';
export type DataKind = 'incidents' | 'tickets' | 'moderation' | 'roles' | 'channels' | 'tasks' | 'analytics' | 'settings';
export interface ApiDeps { token: string; allowedOrigin: string; audit: AuditLog; status(): Promise<Record<string, unknown>>; data?: (kind: DataKind, guildId: string) => Promise<unknown>; }
export interface ApiRes { status: number; headers: Record<string, string>; body: unknown; }
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
// Read-only API for the dashboard. Bearer token required; CORS limited to one configured origin. Never returns secrets.
export async function handleApi(d: ApiDeps, method: string, path: string, authorization: string | undefined): Promise<ApiRes> {
  const headers = { 'access-control-allow-origin': d.allowedOrigin, 'access-control-allow-headers': 'authorization', 'cache-control': 'no-store' };
  if (method === 'OPTIONS') return { status: 204, headers, body: null };
  if (method !== 'GET') return { status: 405, headers, body: { error: 'method not allowed' } };
  if (!d.token || !authorization?.startsWith('Bearer ') || !same(authorization.slice(7), d.token)) return { status: 401, headers, body: { error: 'unauthorized' } };
  if (path === '/api/status') return { status: 200, headers, body: await d.status() };
  const m = /^\/api\/audit\/(\d{5,25})$/.exec(path);
  if (m) return { status: 200, headers, body: { guildId: m[1], chainValid: d.audit.verify(m[1]), records: d.audit.list(m[1]).slice(-100) } };
  const dm = /^\/api\/(incidents|tickets|moderation|roles|channels|tasks|analytics|settings)\/(\d{5,25})$/.exec(path);
  if (dm && d.data) return { status: 200, headers, body: await d.data(dm[1] as DataKind, dm[2]) };
  return { status: 404, headers, body: { error: 'not found' } };
}
