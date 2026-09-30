export interface AegisConfig { env: string; autonomy: 0 | 1 | 2 | 3 | 4 | 5; aiProvider: string; aiModel: string; logLevel: string; missing: string[]; }
const PROVIDERS = ['mock', 'groq', 'gemini', 'openrouter'];
export function loadConfig(e: Record<string, string | undefined>): AegisConfig {
  const missing: string[] = []; const prod = e.NODE_ENV === 'production';
  const a = Number(e.AUTONOMY_LEVEL ?? '1'); if (!Number.isInteger(a) || a < 0 || a > 5) throw new Error('AUTONOMY_LEVEL must be an integer 0-5');
  const p = e.AI_PROVIDER || 'mock'; if (!PROVIDERS.includes(p)) throw new Error(`AI_PROVIDER must be one of ${PROVIDERS.join(', ')}`);
  if (p !== 'mock' && !e.AI_API_KEY) missing.push('AI_API_KEY');
  if (prod) for (const k of ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID']) if (!e[k]) missing.push(k);
  if (missing.length && prod) throw new Error(`missing required env: ${missing.join(', ')}`);
  return { env: e.NODE_ENV ?? 'development', autonomy: a as AegisConfig['autonomy'], aiProvider: p, aiModel: e.AI_MODEL ?? '', logLevel: e.LOG_LEVEL ?? 'info', missing }; // contains no secret values
}
