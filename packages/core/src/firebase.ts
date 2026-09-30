import type { DatabaseProvider } from './db.ts';
// Structural subset of the firebase-admin Firestore API, so this adapter is testable and the SDK is only needed at runtime.
export interface FsDoc { get(): Promise<{ exists: boolean; data(): unknown }>; set(v: unknown): Promise<unknown>; delete(): Promise<unknown>; }
export interface FsLike { doc(path: string): FsDoc; collection(path: string): { get(): Promise<{ docs: { data(): unknown }[] }> }; }
const SAFE = /^[A-Za-z0-9_-]+$/;
export class FirebaseProvider implements DatabaseProvider {
  private fs: FsLike; constructor(fs: FsLike) { this.fs = fs; }
  private p(g: string, c: string, id?: string) { if (![g, c, ...(id ? [id] : [])].every((x) => SAFE.test(x))) throw new Error('invalid path segment'); return `guilds/${g}/${c}${id ? `/${id}` : ''}`; }
  async get(g: string, c: string, id: string) { const s = await this.fs.doc(this.p(g, c, id)).get(); return s.exists ? s.data() : undefined; }
  async set(g: string, c: string, id: string, v: unknown) { await this.fs.doc(this.p(g, c, id)).set(JSON.parse(JSON.stringify(v))); }
  async list(g: string, c: string) { return (await this.fs.collection(this.p(g, c)).get()).docs.map((d) => d.data()); }
  async delete(g: string, c: string, id: string) { await this.fs.doc(this.p(g, c, id)).delete(); }
  async health() { try { await this.fs.doc('system/health').get(); return true; } catch { return false; } }
}
