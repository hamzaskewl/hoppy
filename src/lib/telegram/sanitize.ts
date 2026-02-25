const MAX_MESSAGE_LENGTH = 500;
const MAX_LLM_CALLS_PER_MINUTE = 3;

// In-memory rate limiter (per-user, resets every minute)
const rateLimitMap = new Map<number, { count: number; resetAt: number }>();

// Patterns that indicate encoded injection attempts
const ENCODING_PATTERNS = [
  /\\x[0-9a-f]{2}/gi,                     // Hex escape sequences
  /\\u[0-9a-f]{4}/gi,                      // Unicode escape sequences
  /&#x?[0-9a-f]+;/gi,                     // HTML entities
  /\\u\{[0-9a-f]+\}/gi,                    // ES6 unicode escapes
];

// Common prompt injection markers
const INJECTION_MARKERS = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|prompts?|rules?|context)/i,
  /you\s+are\s+now\s+(a|an|the)\s+/i,
  /system\s*:\s*/i,
  /\[INST\]/i,
  /\[\/INST\]/i,
  /<\|im_start\|>/i,
  /<\|im_end\|>/i,
  /```\s*(system|assistant|user)/i,
  /\bDAN\b.*\bjailbreak/i,
  /do\s+anything\s+now/i,
  /override\s+(your|all|the)\s+(instructions?|rules?|restrictions?)/i,
  /pretend\s+(you\s+are|to\s+be|you're)\s/i,
  /act\s+as\s+(if|though|a|an)\s/i,
  /forget\s+(your|all|everything|previous)/i,
  /new\s+instructions?\s*:/i,
  /roleplay\s+as/i,
];

// Zero-width and invisible characters
const INVISIBLE_CHARS = /[\u200B\u200C\u200D\u200E\u200F\uFEFF\u2060\u2061\u2062\u2063\u2064\u2066\u2067\u2068\u2069\u206A-\u206F\u00AD\u034F\u180E]/g;

// Control characters (except newline, tab)
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export interface SanitizeResult {
  text: string;
  blocked: boolean;
  reason?: string;
}

/**
 * Sanitize user input before processing.
 * Strips dangerous characters, detects injection attempts, enforces length limits.
 */
export function sanitizeInput(rawText: string): SanitizeResult {
  if (!rawText || typeof rawText !== "string") {
    return { text: "", blocked: true, reason: "Empty or invalid input" };
  }

  // Strip invisible and control characters
  let text = rawText
    .replace(INVISIBLE_CHARS, "")
    .replace(CONTROL_CHARS, "")
    .trim();

  // Length limit
  if (text.length > MAX_MESSAGE_LENGTH) {
    text = text.slice(0, MAX_MESSAGE_LENGTH);
  }

  if (text.length === 0) {
    return { text: "", blocked: true, reason: "Message was empty after sanitization" };
  }

  // Check for encoded injection attempts
  let encodedMatchCount = 0;
  for (const pattern of ENCODING_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) encodedMatchCount += matches.length;
  }
  // Allow a few (could be legit addresses), block if excessive
  if (encodedMatchCount > 5) {
    return { text, blocked: true, reason: "Suspicious encoded content detected" };
  }

  // Check for prompt injection markers (only flag for LLM path, don't block entirely)
  // The LLM classifier will see the sanitized text, but these are flagged
  // so the caller knows to treat with extra caution
  for (const pattern of INJECTION_MARKERS) {
    if (pattern.test(text)) {
      console.warn(`[Sanitize] Potential injection detected: "${text.slice(0, 80)}..."`);
      // Don't block -- regex path handles it safely; if it falls to LLM,
      // the hardened system prompt + Zod schema contain the blast radius.
      // But we strip the suspect portion from LLM input.
      text = text.replace(pattern, "[REMOVED]");
    }
  }

  return { text, blocked: false };
}

/**
 * Check if a user can make an LLM call (rate limiting).
 * Returns true if allowed, false if rate-limited.
 */
export function checkLLMRateLimit(tgUserId: number): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(tgUserId);

  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(tgUserId, { count: 1, resetAt: now + 60_000 });
    return true;
  }

  if (entry.count >= MAX_LLM_CALLS_PER_MINUTE) {
    return false;
  }

  entry.count++;
  return true;
}

/**
 * Periodically clean up expired rate limit entries to prevent memory leaks.
 * Call this on an interval (e.g., every 5 minutes).
 */
export function cleanupRateLimits(): void {
  const now = Date.now();
  for (const [userId, entry] of rateLimitMap) {
    if (now >= entry.resetAt) {
      rateLimitMap.delete(userId);
    }
  }
}

// Auto-cleanup every 5 minutes
if (typeof setInterval !== "undefined") {
  setInterval(cleanupRateLimits, 5 * 60 * 1000);
}
