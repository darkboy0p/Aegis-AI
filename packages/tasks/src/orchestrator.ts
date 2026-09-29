export interface Task { id: string; priority: number; deps: string[]; locks: string[]; retries: number; timeoutMs: number; run(signal: AbortSignal): Promise<unknown>; }
export interface TaskState { status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled'; result?: unknown; error?: string; attempts: number; }
// Dependency-graph runner: independent tasks run in parallel; tasks sharing a lock never overlap.
export class TaskOrchestrator {
  private ac = new AbortController();
  cancel() { this.ac.abort(); }
  async runAll(tasks: Task[]): Promise<Map<string, TaskState>> {
    const st = new Map<string, TaskState>(tasks.map((t) => [t.id, { status: 'pending', attempts: 0 }]));
    const held = new Set<string>(); const running = new Set<Promise<void>>();
    const exec = async (t: Task) => {
      const s = st.get(t.id)!; s.status = 'running';
      for (let a = 0; a <= t.retries; a++) {
        s.attempts = a + 1;
        const to = new AbortController(); const timer = setTimeout(() => to.abort(), t.timeoutMs);
        const sig = AbortSignal.any([this.ac.signal, to.signal]);
        try {
          s.result = await Promise.race([t.run(sig), new Promise((_, rej) => sig.addEventListener('abort', () => rej(new Error('timeout or cancelled'))))]);
          s.status = 'done'; return;
        } catch (e) { s.error = (e as Error).message; if (this.ac.signal.aborted) { s.status = 'cancelled'; return; } } finally { clearTimeout(timer); }
      }
      s.status = 'failed';
    };
    for (;;) {
      if (this.ac.signal.aborted) for (const s of st.values()) if (s.status === 'pending') s.status = 'cancelled';
      for (const t of tasks) { const s = st.get(t.id)!; if (s.status === 'pending' && t.deps.some((d) => ['failed', 'cancelled'].includes(st.get(d)?.status ?? 'failed'))) { s.status = 'cancelled'; s.error = 'dependency failed'; } }
      const ready = tasks.filter((t) => st.get(t.id)!.status === 'pending' && t.deps.every((d) => st.get(d)?.status === 'done')).sort((a, b) => b.priority - a.priority);
      for (const t of ready) {
        if (t.locks.some((l) => held.has(l))) continue;
        t.locks.forEach((l) => held.add(l)); st.get(t.id)!.status = 'running';
        const p: Promise<void> = exec(t).finally(() => { t.locks.forEach((l) => held.delete(l)); running.delete(p); }); running.add(p);
      }
      if (running.size === 0) break;
      await Promise.race(running);
    }
    return st;
  }
}
