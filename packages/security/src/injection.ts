const P = [/ignore (all |any )?(previous|prior|above) (instructions|rules)/i, /(reveal|print|show).{0,30}(system prompt|token|api key|secret)/i, /you are now (in )?(dan|developer mode|admin)/i, /disregard (your|the) (policy|policies|guidelines)/i, /grant (yourself|me) admin/i];
export function scanInjection(text: string) { const hits = P.filter((r) => r.test(text)).map(String); return { suspicious: hits.length > 0, hits }; }
// Untrusted Discord text is fenced as data; the model is told never to treat it as instructions.
export function wrapUntrusted(text: string) { return `<untrusted_discord_message>\n${text.replace(/<\/?untrusted_discord_message>/gi, '')}\n</untrusted_discord_message>`; }
