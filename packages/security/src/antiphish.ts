const OFFICIAL = ['discord.com', 'discord.gg', 'discordapp.com', 'discord.media', 'steampowered.com', 'steamcommunity.com', 'youtube.com', 'github.com'];
const BRANDS = ['discord', 'steam', 'nitro', 'epicgames', 'roblox'];
const SHORT = ['bit.ly', 'tinyurl.com', 't.co', 'is.gd', 'cutt.ly', 'rb.gy'];
const BAD_TLD = ['.tk', '.ml', '.ga', '.cf', '.gq', '.xyz', '.top', '.click'];
const BAIT = /(free\s+nitro|claim\s+(your\s+)?(gift|reward)|airdrop|verify\s+your\s+account|steam\s+gift)/i;
export interface PhishResult { score: number; confidence: 'low' | 'medium' | 'high'; reasons: string[]; urls: string[]; }
const on = (h: string, d: string) => h === d || h.endsWith('.' + d);
// Heuristic scoring, not a verdict: reasons are listed so staff can see why. No network lookups are made.
export function analyzeMessage(text: string): PhishResult {
  const urls = text.match(/https?:\/\/[^\s<>()]+/gi) ?? []; const reasons: string[] = []; let score = 0;
  for (const u of urls) {
    let x: URL; try { x = new URL(u); } catch { continue; }
    const h = x.hostname.toLowerCase(); const official = OFFICIAL.some((d) => on(h, d));
    if (h.includes('xn--')) { score += 35; reasons.push(`punycode host ${h}`); }
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) { score += 30; reasons.push('raw IP address link'); }
    if (x.username) { score += 30; reasons.push('credentials-style @ in URL'); }
    if (!official && BRANDS.some((b) => h.includes(b))) { score += 45; reasons.push(`brand lookalike ${h}`); }
    if (SHORT.includes(h)) { score += 15; reasons.push('URL shortener hides destination'); }
    if (BAD_TLD.some((t) => h.endsWith(t))) { score += 10; reasons.push(`low-reputation TLD on ${h}`); }
  }
  if (urls.length && BAIT.test(text)) { score += 20; reasons.push('scam bait wording'); }
  score = Math.min(100, score);
  return { score, confidence: score >= 70 ? 'high' : score >= 40 ? 'medium' : 'low', reasons, urls };
}
