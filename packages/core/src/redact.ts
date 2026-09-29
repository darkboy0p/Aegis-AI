const P = [/[MN][A-Za-z\d]{23,}\.[\w-]{6}\.[\w-]{27,}/g, /-----BEGIN[\s\S]*?PRIVATE KEY-----/g, /gh[pousr]_[A-Za-z0-9]{36,}/g];
export function redact(v: unknown): string {
  let s = typeof v === 'string' ? v : JSON.stringify(v) ?? '';
  for (const r of P) s = s.replace(r, '[REDACTED]');
  return s.replace(/(token|secret|apikey|api_key|private_?key|password)(["']?\s*[:=]\s*["']?)[^\s"',}]+/gi, '$1$2[REDACTED]');
}
