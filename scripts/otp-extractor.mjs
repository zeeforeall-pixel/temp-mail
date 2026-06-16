/**
 * otp-extractor.mjs — Server-side OTP and verification link extraction.
 *
 * Node.js version of js/otp.js without DOM dependencies.
 * Extracts OTP codes and verification links from email content.
 *
 * Usage:
 *   import { extractOTP, extractVerifyLink } from "./otp-extractor.mjs";
 *
 *   const otp = extractOTP(emailText);
 *   const link = extractVerifyLink(emailHtml);
 */

// ── Keyword patterns (multilingual) ──

const OTP_KEYWORDS = /(verification code|verification|one.time password|otp|security code|login code|confirmation code|sign.in code|magic code|access code|two.factor|2fa|mfa|passcode|passkey|activate|register|log.?in|kode verifikasi|kode|pin|code|verify|confirm|token|secret|código|código de verificación|código de seguridad|verificación|confirmação|código de acceso|verificar|verifizierung|bestätigungscode|bestätigen|einmalpasswort|code de vérification|code de sécurité|vérifier|confirmer|验证码|確認コード|確認|인증|인증 코드|확인|подтверждение|код подтверждения|код)/i;

const NON_OTP_KEYWORDS = /\b(order|ref|reference|invoice|tracking|ticket|total|price|rp|usd|amount|balance|phone|tel|fax|zip|postal|version|qty|quantity|subtotal|discount|product|serial|pat|unit|shipping|item|expressway|santa|san|drive|street|st\.|avenue|ave|blvd|boulevard|lane|ln|way|road|corp|corporation|inc|ltd|rights|reserved|copyright|nvidia|amd|intel|google|microsoft|apple|amazon|®|©|™|january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec|monday|tuesday|wednesday|thursday|friday|saturday|sunday|born|birth|age|since|founded|established|created on|registered on|updated|modified|published|received|sent|delivered|expired|deadline|scheduled|appointment|meeting|conference|birthday|anniversary|holiday|christmas|thanksgiving|easter|account no|transaction|receipt|statement|balance|payment|transfer|deposit|withdrawal|subscription|membership|policy|claim|settlement|warranty|license|permit|certificate|registration|passport|ssn|social security|tax|vat|gst|registration no)\b/i;

// Common words that look like codes but aren't
const COMMON_WORDS = /^(code|pin|token|key|id|pass|user|name|test|demo|sample|example|temp|new|old|valid|active|inactive|pending|approved|rejected|success|failed|error|warning|info|note|message|email|phone|address|city|state|country)$/i;

// ── Verification link patterns ──

const VERIFY_URL_KEYWORDS = /(verify|confirm|activation|activate|validate|approve|accept|enable|complete|claim|auth|token|register|sign.?up|onboard|unlock|welcome|email.?confirm|verif|bestätig|vérifi|verific|подтвержд|确认|確認|인증)/i;

const NON_VERIFY_URL_PATTERNS = [
  /\/unsubscribe/i,
  /\/opt.?out/i,
  /\/preferences/i,
  /\/settings/i,
  /\/privacy/i,
  /\/terms/i,
  /\/help/i,
  /\/support/i,
  /\/contact/i,
  /\/faq/i,
  /\/about/i,
  /\/legal/i,
  /\/cookie/i,
  /\.css$/i,
  /\.js$/i,
  /\.png$/i,
  /\.jpg$/i,
  /\.gif$/i,
  /\.svg$/i,
  /\.ico$/i,
  /pixel/i,
  /track(?:ing)?/i,
  /analytics/i,
  /google-analytics/i,
  /googleads/i,
  /doubleclick/i,
  /facebook\.com\/tr/i,
  /mailchimp/i,
  /sendgrid/i,
];

const BLOCKED_LINK_DOMAINS = /(facebook|twitter|instagram|linkedin|youtube|google|apple|microsoft|amazon|github|stackoverflow|medium|wordpress|wix|squarespace|shopify|etsy|ebay|aliexpress|pinterest|tumblr|reddit|quora|wikipedia|archive\.org|wayback)/i;

// ── HTML stripping ──

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// ── OTP extraction ──

export function extractOTP(text) {
  if (!text) return null;

  const plainText = text.includes("<") ? stripHtml(text) : text;
  const candidates = [];

  const words = plainText.split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    const word = words[i].replace(/[.,;:!?]+$/, "");

    if (OTP_KEYWORDS.test(word)) {
      for (let j = i + 1; j < Math.min(i + 5, words.length); j++) {
        const candidate = words[j].replace(/[.,;:!?()]+$/, "");
        
        // Skip common words
        if (COMMON_WORDS.test(candidate)) continue;
        
        // Must be numeric or alphanumeric with digits
        const hasDigit = /\d/.test(candidate);
        const isNumeric = /^\d{3,8}$/.test(candidate);
        const isAlphanumeric = /^[A-Z0-9]{4,8}$/i.test(candidate) && hasDigit;
        
        if (isNumeric || isAlphanumeric) {
          if (!NON_OTP_KEYWORDS.test(candidate) && !/^20\d{2}$/.test(candidate)) {
            const digits = candidate.replace(/\D/g, "");
            if (!/^(\d)\1+$/.test(digits)) {
              // Higher score for numeric codes
              const baseScore = isNumeric ? 10 : 5;
              candidates.push({ val: candidate, score: baseScore - (j - i) });
            }
          }
        }
      }
    }
  }

  if (candidates.length === 0) {
    const codePattern = /\b(\d{4,8})\b/g;
    let match;
    while ((match = codePattern.exec(plainText)) !== null) {
      const code = match[1];
      const before = plainText.slice(Math.max(0, match.index - 50), match.index);
      const after = plainText.slice(match.index + code.length, match.index + code.length + 50);
      const context = before + " " + after;

      if (OTP_KEYWORDS.test(context) && !NON_OTP_KEYWORDS.test(context)) {
        if (!/^(\d)\1+$/.test(code) && !/^20\d{2}$/.test(code)) {
          candidates.push({ val: code, score: 1 });
        }
      }
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0].val;
}

// ── Verification link extraction ──

function isVerificationLink(url) {
  try {
    const u = new URL(url);
    if (BLOCKED_LINK_DOMAINS.test(u.hostname)) return false;
    const urlText = u.pathname + u.search;
    for (const pattern of NON_VERIFY_URL_PATTERNS) {
      if (pattern.test(urlText)) return false;
    }
    return VERIFY_URL_KEYWORDS.test(urlText) || VERIFY_URL_KEYWORDS.test(u.hostname);
  } catch {
    return false;
  }
}

export function extractVerifyLink(text) {
  if (!text) return null;

  const urlPattern = /https?:\/\/[^\s<>"\')]+/g;
  const urls = text.match(urlPattern) || [];

  const linkCandidates = [];
  for (const rawUrl of urls) {
    const url = rawUrl.replace(/[.,;:!?)]+$/, "");
    try {
      const u = new URL(url);
      if (BLOCKED_LINK_DOMAINS.test(u.hostname)) continue;
      const urlText = u.pathname + u.search;
      let blocked = false;
      for (const pattern of NON_VERIFY_URL_PATTERNS) {
        if (pattern.test(urlText)) { blocked = true; break; }
      }
      if (blocked) continue;
      if (isVerificationLink(url)) {
        linkCandidates.push({ url, score: 1 });
      }
    } catch {
      continue;
    }
  }

  if (linkCandidates.length === 0) {
    const tokenPathRe = /\/[a-f0-9-]{16,}|\/[a-zA-Z0-9_-]{20,}/;
    for (const rawUrl of urls) {
      const url = rawUrl.replace(/[.,;:!?)]+$/, "");
      try {
        const u = new URL(url);
        if (BLOCKED_LINK_DOMAINS.test(u.hostname)) continue;
        let blocked = false;
        for (const p of NON_VERIFY_URL_PATTERNS) {
          if (p.test(u.pathname + u.search)) { blocked = true; break; }
        }
        if (blocked) continue;
        if (tokenPathRe.test(u.pathname)) {
          linkCandidates.push({ url, score: 1 });
        }
      } catch { continue; }
    }
  }

  if (linkCandidates.length === 0) return null;

  linkCandidates.sort((a, b) => b.score - a.score);
  return linkCandidates[0].url;
}

// ── Combined extraction ──

export function extractVerification(text) {
  return {
    otp: extractOTP(text),
    link: extractVerifyLink(text),
  };
}
