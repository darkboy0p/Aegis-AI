export type SystemState = 'HEALTHY' | 'DEGRADED' | 'WARNING' | 'CRITICAL' | 'OFFLINE';
export interface Probe { ok: boolean; latencyMs?: number; }
const CRITICAL = ['Discord', 'Database'];
export function evaluate(probes: Record<string, Probe>, o: { heapUsedRatio?: number; maxLatencyMs?: number } = {}): { state: SystemState; issues: string[] } {
  const names = Object.keys(probes); const down = names.filter((n) => !probes[n].ok); const issues = down.map((n) => `${n} check failed`);
  if (names.length && down.length === names.length) return { state: 'OFFLINE', issues };
  if (down.some((n) => CRITICAL.includes(n))) return { state: 'CRITICAL', issues };
  if (down.length) return { state: 'DEGRADED', issues };
  const slow = names.filter((n) => (probes[n].latencyMs ?? 0) > (o.maxLatencyMs ?? 1000)); slow.forEach((n) => issues.push(`${n} latency high`));
  if ((o.heapUsedRatio ?? 0) > 0.85) issues.push('memory pressure');
  return { state: issues.length ? 'WARNING' : 'HEALTHY', issues };
}
// Bounded retry for transient failures only. Anything not marked transient fails immediately.
export async function withRetry<T>(fn: () => Promise<T>, o: { tries?: number; isTransient?: (e: Error) => boolean; sleep?: (ms: number) => Promise<void> } = {}): Promise<T> {
  const tries = o.tries ?? 3; const sleep = o.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 1; ; i++) { try { return await fn(); } catch (e) { if (i >= tries || !(o.isTransient ?? (() => true))(e as Error)) throw e; await sleep(2 ** i * 100); } }
}
