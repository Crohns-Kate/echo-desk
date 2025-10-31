const SYSTEM_TOKENS = new Set([
  'redirect_to_wizard','build__wizard','build_canary','canary',
  'ASK_EMAIL','CONFIRM_EMAIL_OK','CONFIRM_EMAIL_NO',
  'ASK_DAY','ASK_MORNING_AFTERNOON','BOOK_PARTIAL','REPROMPT_GENERIC',
  'FALLBACK_TO_STAFF','GOODBYE'
]);

export function isSystemToken(text?: string|null) {
  if (!text) return false;
  const t = String(text).trim();
  if (SYSTEM_TOKENS.has(t)) return true;
  if (/^[A-Z0-9_]+$/.test(t)) return true;
  if (t.includes('__')) return true;
  return false;
}

export function safeSpoken(text: string) {
  if (isSystemToken(text)) return '';
  return text
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/[""'']/g, '"')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
