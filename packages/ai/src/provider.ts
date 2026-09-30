export interface Prompt { system: string; user: string; json?: boolean; }
export interface AIProvider {
  readonly name: string;
  generate(p: Prompt): Promise<string>;
  healthCheck(): Promise<boolean>;
  getModelInfo(): { provider: string; model: string };
}
export type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export class MockProvider implements AIProvider {
  readonly name = 'mock'; private q: string[]; calls: Prompt[] = [];
  constructor(responses: string[] = []) { this.q = [...responses]; }
  async generate(p: Prompt) { this.calls.push(p); return this.q.shift() ?? '{"actions":[]}'; }
  async healthCheck() { return true; }
  getModelInfo() { return { provider: 'mock', model: 'mock' }; }
}

// Groq and OpenRouter both expose the OpenAI chat-completions format.
export class OpenAICompatProvider implements AIProvider {
  readonly name: string; private url: string; private key: string; private model: string; private f: FetchFn;
  constructor(name: 'groq' | 'openrouter', key: string, model: string, f: FetchFn) {
    this.name = name; this.key = key; this.model = model; this.f = f;
    this.url = name === 'groq' ? 'https://api.groq.com/openai/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';
  }
  async generate(p: Prompt) {
    const r = await this.f(this.url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.key}` },
      body: JSON.stringify({ model: this.model, messages: [{ role: 'system', content: p.system }, { role: 'user', content: p.user }], ...(p.json ? { response_format: { type: 'json_object' } } : {}) }) });
    if (!r.ok) throw new Error(`${this.name} HTTP ${r.status}`);
    const t = (await r.json())?.choices?.[0]?.message?.content; if (typeof t !== 'string') throw new Error(`${this.name}: malformed response`); return t;
  }
  async healthCheck() { try { await this.generate({ system: 'Reply with OK.', user: 'ping' }); return true; } catch { return false; } }
  getModelInfo() { return { provider: this.name, model: this.model }; }
}

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini'; private key: string; private model: string; private f: FetchFn;
  constructor(key: string, model: string, f: FetchFn) { this.key = key; this.model = model; this.f = f; }
  async generate(p: Prompt) {
    const r = await this.f(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, { method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.key },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: p.system }] }, contents: [{ role: 'user', parts: [{ text: p.user }] }], ...(p.json ? { generationConfig: { responseMimeType: 'application/json' } } : {}) }) });
    if (!r.ok) throw new Error(`gemini HTTP ${r.status}`);
    const t = (await r.json())?.candidates?.[0]?.content?.parts?.[0]?.text; if (typeof t !== 'string') throw new Error('gemini: malformed response'); return t;
  }
  async healthCheck() { try { await this.generate({ system: 'Reply with OK.', user: 'ping' }); return true; } catch { return false; } }
  getModelInfo() { return { provider: 'gemini', model: this.model }; }
}

// Tries providers in order so Aegis does not depend on a single vendor.
export class FallbackProvider implements AIProvider {
  readonly name = 'fallback'; private ps: AIProvider[];
  constructor(ps: AIProvider[]) { this.ps = ps; }
  async generate(p: Prompt) {
    const errs: string[] = [];
    for (const x of this.ps) { try { return await x.generate(p); } catch (e) { errs.push(`${x.name}: ${(e as Error).message}`); } }
    throw new Error(`all AI providers failed (${errs.join('; ')})`);
  }
  async healthCheck() { for (const x of this.ps) if (await x.healthCheck()) return true; return false; }
  getModelInfo() { return this.ps[0]?.getModelInfo() ?? { provider: 'none', model: '' }; }
}
