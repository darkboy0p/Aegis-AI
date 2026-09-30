export interface Job { name: string; everyMs: number; run(): Promise<void>; lastRun?: number; runOnStart?: boolean; }
// tick() is pure with respect to time so it can be tested; start() drives it from a real interval in the bot process.
export class Scheduler {
  private jobs: Job[] = []; private timer?: ReturnType<typeof setInterval>; errors: string[] = [];
  add(j: Job) { this.jobs.push({ ...j, lastRun: j.runOnStart === false ? Date.now() : j.lastRun }); }
  async tick(now = Date.now()) { for (const j of this.jobs) if (j.lastRun === undefined ? true : now - j.lastRun >= j.everyMs) { j.lastRun = now; try { await j.run(); } catch (e) { this.errors.push(`${j.name}: ${(e as Error).message}`); } } }
  start(checkMs = 30_000) { this.timer = setInterval(() => { this.tick().catch(() => {}); }, checkMs); }
  stop() { if (this.timer) clearInterval(this.timer); }
}
