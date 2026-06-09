/**
 * otp.js — OTP / verification code + link extraction from email text.
 *
 * Detects two types of verification content:
 *   1. OTP codes — numeric or alphanumeric verification codes
 *   2. Verification links — clickable URLs to confirm/activate accounts
 *
 * Public API:
 *   extractOTP(text)           → string | null  (best OTP code)
 *   extractVerifyLink(text)    → string | null  (best verification URL)
 *   extractVerification(text)  → { otp, link }  (both at once)
 *
 * Strategy for OTP extraction (in priority order):
 *   1. Scan visually prominent HTML elements (bold, headings, etc.)
 *   1b. Detect split-digit rendering (consecutive single-char spans)
 *   2. Scan text near OTP-related keywords (multilingual)
 *   3. Fallback scan over all words in stripped plain text
 *
 * Strategy for link extraction:
 *   1. Scan <a> elements for verification-related URLs
 *   2. Check prominent position (large buttons, first/only link)
 *   3. Keyword proximity — links near "verify", "confirm", etc.
 *
 * Test cases (as comments):
 *   "Your verification code is 847291"            → "847291"
 *   "Use code A5G2 to sign in"                     → "A5G2"
 *   "Order #12345 confirmed, total $99.00"         → null (not OTP)
 *   "Your OTP: <b>384-291</b>"                     → "384-291"
 *   "Copyright 2024 Corp. Ref: 98765"              → null
 *   "<h2>Your code is 9F8R4</h2>"                  → "9F8R4"
 *   "Pin: 1111"                                    → null (all same digits)
 *   "Year 2024 report attached"                    → null (year)
 *   "<span>3</span><span>8</span><span>4</span>"   → "384" (split digits)
 *   "验证码: 847291"                                → "847291" (Chinese)
 *   "Click here to verify: https://app.com/v?t=x" → link extracted
 *   "Your code is aGVsbG8gd29ybG=="                → null (base64)
 */

// ── Keyword patterns (multilingual) ──

const OTP_KEYWORDS = /\b(verification code|verification|one.time password|otp|security code|login code|confirmation code|sign.in code|magic code|access code|two.factor|2fa|mfa|passcode|passkey|activate|register|log.?in|kode verifikasi|kode|pin|verify|confirm|token|secret|código|código de verificación|código de seguridad|verificación|confirmação|código de acesso|verificar|verifizierung|bestätigungscode|bestätigen|einmalpasswort|code de vérification|code de sécurité|vérifier|confirmer|验证码|確認コード|確認|인증|인증 코드|확인|подтверждение|код подтверждения|код)\b/i;

const NON_OTP_KEYWORDS = /\b(order|ref|reference|invoice|tracking|ticket|total|price|rp|usd|amount|balance|phone|tel|fax|zip|postal|version|qty|quantity|subtotal|discount|product|serial|pat|unit|shipping|item|expressway|santa|san|drive|street|st\.|avenue|ave|blvd|boulevard|lane|ln|way|road|corp|corporation|inc|ltd|rights|reserved|copyright|nvidia|amd|intel|google|microsoft|apple|amazon|®|©|™|january|february|march|april|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec|monday|tuesday|wednesday|thursday|friday|saturday|sunday|born|birth|age|since|founded|established|created on|registered on|updated|modified|published|received|sent|delivered|expired|deadline|scheduled|appointment|meeting|conference|birthday|anniversary|holiday|christmas|thanksgiving|easter|account no|transaction|receipt|statement|balance|payment|transfer|deposit|withdrawal|subscription|membership|policy|claim|settlement|warranty|license|permit|certificate|registration|passport|ssn|social security|tax|vat|gst|registration no)\b/i;

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

// ── Helpers ──

/**
 * Check if a numeric string is unlikely to be an OTP.
 * Filters out: years, all-same-digit, date formats, phone numbers,
 * Unix timestamps, sequential patterns, times, and more.
 */
function isNonOtpNumber(val) {
  if (!/^\d+$/.test(val)) return false;
  const n = parseInt(val, 10);
  const len = val.length;

  // Years: 1900–2099 (4 digits)
  if (len === 4 && n >= 1900 && n <= 2099) return true;

  // All-same-digit: 0000, 1111, 2222, etc.
  if (/^(\d)\1+$/.test(val)) return true;

  // YYYYMMDD date format (8 digits, valid month 01-12, valid day 01-31)
  if (len === 8) {
    const y = parseInt(val.slice(0, 4), 10);
    const m = parseInt(val.slice(4, 6), 10);
    const d = parseInt(val.slice(6, 8), 10);
    if (y >= 1950 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= 31) return true;
  }

  // MMDDYYYY date format (8 digits)
  if (len === 8) {
    const m = parseInt(val.slice(0, 2), 10);
    const d = parseInt(val.slice(2, 4), 10);
    const y = parseInt(val.slice(4, 8), 10);
    if (y >= 1950 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= 31) return true;
  }

  // DDMMYYYY date format (8 digits)
  if (len === 8) {
    const d = parseInt(val.slice(0, 2), 10);
    const m = parseInt(val.slice(2, 4), 10);
    const y = parseInt(val.slice(4, 8), 10);
    if (y >= 1950 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= 31) return true;
  }

  // Unix timestamps: 10 digits starting with 1 (covers 2001-2033)
  if (len === 10 && val[0] === '1') return true;

  // Phone-number-length: 10+ digits (likely phone, tracking, account number)
  if (len >= 10) return true;

  // HHMM time format — only filter when context confirms it's a time
  // (moved to isNonOtpByContext to avoid killing legitimate 4-digit OTPs)

  // Sequential ascending: 1234, 12345, 123456, 1234567, 12345678
  if (len >= 4 && /^12345?6?7?8?9?0?$/.test(val)) return true;

  // Sequential descending: 9876, 98765, etc.
  if (len >= 4) {
    let descending = true;
    for (let i = 1; i < len; i++) {
      if (parseInt(val[i], 10) !== parseInt(val[i - 1], 10) - 1) {
        descending = false;
        break;
      }
    }
    if (descending) return true;
  }

  // Very short (3 digits) — unlikely to be an OTP on its own unless
  // it's from a prominent position (handled by priority system)
  // We don't filter these here — priority handles it.

  return false;
}

/**
 * Check if surrounding context suggests the number is a date, phone, etc.
 * @param {string} val - The number being tested.
 * @param {string} context - Surrounding text (up to ~120 chars).
 */
function isNonOtpByContext(val, context) {
  if (!context) return false;
  const lower = context.toLowerCase();

  // Date context: month name within 30 chars of the number
  if (/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/i.test(context)) {
    // Check if the number is near the month word
    const monthMatch = context.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/i);
    if (monthMatch) {
      const monthIdx = context.toLowerCase().indexOf(monthMatch[0].toLowerCase());
      const numIdx = context.indexOf(val);
      if (numIdx !== -1 && Math.abs(numIdx - monthIdx) < 40) return true;
    }
  }

  // Date separator context: number near slashes/dashes forming date patterns
  // e.g., "01/15/2024", "15-01-2024"
  if (/\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/.test(context) && val.length >= 3) {
    return true;
  }

  // Copyright year context: "© 2024", "Copyright 2024", "2019-2024"
  if (/(©|copyright|all rights reserved)/i.test(context) && val.length === 4) {
    const n = parseInt(val, 10);
    if (n >= 1900 && n <= 2099) return true;
  }

  // Phone number context
  if (/(phone|tel|fax|mobile|call|contact|whatsapp|sms)/i.test(context) && val.length >= 7) {
    return true;
  }

  // IP address context: number between dots like 192.168.1.1
  if (/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/.test(context) && val.length <= 3) {
    return true;
  }

  // Currency/amount context
  if (/[\$€£¥]\s*\d|[\d]\s*[\$€£¥]|(\d+(\.\d+)?)\s*(usd|eur|gbp|jpy|idr|rp)/i.test(context)) {
    return true;
  }

  // Percentage context
  if (/\d+%|percent|percentage/i.test(context)) {
    return true;
  }

  // Time context: only filter 4-digit numbers as times when clearly indicated
  // e.g., "at 1430", "time: 0931", "1430 hours", "0930 hrs", "14:30", "2:30pm"
  if (val.length === 4) {
    const hh = parseInt(val.slice(0, 2), 10);
    const mm = parseInt(val.slice(2, 4), 10);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      if (/\b(at|time|hrs?|hours?|am|pm|o.?clock|scheduled|departure|arrival|boarding)\b/i.test(context)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a string looks like base64 (long, mixed case, ends with = or ==).
 */
function looksLikeBase64(val) {
  if (val.length < 12) return false;
  if (/=$/.test(val)) return true;
  // Long alphanumeric strings with mixed case and no clear OTP pattern
  if (val.length > 20 && /^[A-Za-z0-9+/]+$/.test(val)) return true;
  return false;
}

/**
 * Check if a URL is a verification link (not unsubscribe/tracking/etc.)
 */
function isVerificationLink(url) {
  // Must be a valid URL
  try {
    const u = new URL(url);
    // Check for verification keywords in the URL
    const urlText = u.pathname + u.search;
    if (VERIFY_URL_KEYWORDS.test(urlText)) {
      // Make sure it's not an unsubscribe/tracking link
      for (const pattern of NON_VERIFY_URL_PATTERNS) {
        if (pattern.test(urlText)) return false;
      }
      return true;
    }
    // Also check if the URL has a token/hash/code parameter with a substantial value
    for (const [key, value] of u.searchParams) {
      const lk = key.toLowerCase();
      if (
        (lk === 'token' || lk === 'code' || lk === 'hash' ||
         lk === 'key' || lk === 'id' || lk === 't' ||
         lk === 'confirm' || lk === 'verify') &&
        value && value.length >= 8
      ) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Validate a raw string and add it as a candidate if it looks like an OTP.
 */
function addCandidate(candidates, val, priority, context) {
  const cleanVal = val.trim();
  if (!cleanVal) return;

  // Filter out base64-looking strings
  if (looksLikeBase64(cleanVal)) return;

  // Filter out things that look like URL fragments
  if (/\//.test(cleanVal) || /\.\w{2,4}$/.test(cleanVal)) return;

  // Hyphenated code: 123-456, A1B-2C3
  if (/^[A-Z0-9]{3,5}-[A-Z0-9]{3,5}$/i.test(cleanVal)) {
    candidates.push({ val: cleanVal.toUpperCase(), priority, context });
    return;
  }

  const len = cleanVal.length;
  if (len < 3 || len > 12) return;

  // Pure digits
  if (/^\d+$/.test(cleanVal)) {
    if (isNonOtpNumber(cleanVal)) return;
    if (isNonOtpByContext(cleanVal, context)) return;
    candidates.push({ val: cleanVal, priority, context });
    return;
  }

  // Mixed alphanumeric (e.g., A5G, 9F8R4)
  if (/[a-zA-Z]/.test(cleanVal) && /\d/.test(cleanVal)) {
    candidates.push({ val: cleanVal.toUpperCase(), priority, context });
    return;
  }

  // Pure uppercase letters (4–8 chars, excluding common English words)
  if (/^[A-Za-z]+$/.test(cleanVal) && cleanVal === cleanVal.toUpperCase()) {
    if (
      len >= 4 &&
      len <= 8 &&
      !/^(CODE|VERIFY|EMAIL|INBOX|USER|LOGIN|AUTH|TOKEN|PASS|HERE|CLICK|LINK|OPEN|GO|YES|NO|OK|SIGN|VIEW|READ|MORE|THIS|THAT|NEXT|BACK|HOME|HELP|SEND|POST|FROM|REPLY|DATE|TIME|NAME|TYPE|SIZE|PAGE|LIST|SHOW|LOAD|EDIT|COPY|MOVE|SAVE|DONE|EXIT|STOP|START|PLAY|PAUSE|NEW|OLD)$/i.test(cleanVal)
    ) {
      candidates.push({ val: cleanVal, priority, context });
    }
  }
}

// ── Scanning phases ──

/**
 * Phase 1: Scan visually prominent HTML elements (bold, headings, etc.)
 */
function scanProminentElements(doc) {
  const candidates = [];
  const selector =
    'b, strong, h1, h2, h3, h4, h5, h6, em, u, mark, td, th, ' +
    '[class*="otp"], [id*="otp"], [class*="code"], [id*="code"], ' +
    '[class*="pin"], [id*="pin"], [class*="verify"], [id*="verify"], ' +
    '[class*="token"], [id*="token"], [class*="number"], [id*="number"]';

  const elements = doc.querySelectorAll(selector);
  for (const el of elements) {
    const innerText = el.textContent.trim();
    if (!innerText || innerText.length > 50) continue;

    if (/^[A-Z0-9-]{3,12}$/i.test(innerText)) {
      addCandidate(candidates, innerText, 1, innerText);
    } else {
      const words = innerText.split(/[^A-Za-z0-9-]+/);
      for (const w of words) {
        if (/^[A-Z0-9-]{3,12}$/i.test(w)) {
          addCandidate(candidates, w, 1, innerText);
        }
      }
    }
  }
  return candidates;
}

/**
 * Phase 1b: Detect split-digit rendering.
 * Services like Google render OTPs as individual spans:
 *   <span>3</span><span>8</span><span>4</span><span>2</span><span>9</span><span>1</span>
 * or with letter-spacing: "3 8 4 2 9 1"
 */
function scanSplitDigits(doc) {
  const candidates = [];

  // Look for containers with multiple single-character child elements
  const allElements = doc.querySelectorAll('*');
  for (const el of allElements) {
    const children = el.children;
    if (!children || children.length < 4 || children.length > 12) continue;

    // Check if all direct children contain exactly one character each
    let allSingleChar = true;
    let merged = '';
    for (const child of children) {
      const text = child.textContent.trim();
      if (text.length !== 1 || !/[0-9A-Za-z]/.test(text)) {
        allSingleChar = false;
        break;
      }
      merged += text;
    }

    if (allSingleChar && merged.length >= 4 && merged.length <= 12) {
      // Only accept if it's mostly digits (OTP) or mixed (alphanumeric code)
      const digitRatio = (merged.match(/\d/g) || []).length / merged.length;
      if (digitRatio >= 0.3) {
        addCandidate(candidates, merged, 1, `[split-digits: ${merged}]`);
      }
    }
  }

  // Also detect spaced digits in text content: "3 8 4 2 9 1"
  const prominentSelector =
    'b, strong, h1, h2, h3, h4, h5, h6, td, th, ' +
    '[class*="code"], [class*="otp"], [class*="pin"]';
  const prominentEls = doc.querySelectorAll(prominentSelector);
  for (const el of prominentEls) {
    const text = el.textContent.trim();
    // Match sequences of single chars separated by spaces or non-breaking spaces
    const spacedMatch = text.match(/^([0-9A-Za-z](?:[\s\u00a0][0-9A-Za-z]){3,11})$/);
    if (spacedMatch) {
      const merged = text.replace(/[\s\u00a0]/g, '');
      if (merged.length >= 4 && merged.length <= 12) {
        addCandidate(candidates, merged, 1, `[spaced: ${text}]`);
      }
    }
  }

  return candidates;
}

/**
 * Phase 2: Scan text near OTP-related keywords (multilingual).
 */
function scanKeywordProximity(plainText) {
  const candidates = [];
  let searchFrom = 0;
  let kwMatch;

  // Reset regex lastIndex
  OTP_KEYWORDS.lastIndex = 0;

  while ((kwMatch = OTP_KEYWORDS.exec(plainText.slice(searchFrom))) !== null) {
    const absIdx = searchFrom + kwMatch.index;
    const surrounding = plainText.slice(
      Math.max(0, absIdx - 20),
      absIdx + 120
    );
    const afterKw = plainText.slice(absIdx, absIdx + 120);
    const words = afterKw.split(/[^A-Za-z0-9-]+/);

    for (const w of words) {
      if (/^[A-Z0-9-]{3,12}$/i.test(w)) {
        addCandidate(candidates, w, 2, surrounding);
      }
    }

    // Also check for spaced digits near keywords
    const spacedMatch = afterKw.match(
      /([\s\u00a0]*[0-9A-Za-z]){4,12}[\s\u00a0]*/
    );
    if (spacedMatch) {
      const merged = spacedMatch[0].replace(/[\s\u00a0]/g, '');
      if (merged.length >= 4 && merged.length <= 12) {
        const digitRatio = (merged.match(/\d/g) || []).length / merged.length;
        if (digitRatio >= 0.3) {
          addCandidate(candidates, merged, 2, surrounding);
        }
      }
    }

    searchFrom = absIdx + 1;
  }
  return candidates;
}

/**
 * Strip URLs from text to prevent URL fragments being matched as OTPs.
 */
function stripUrls(text) {
  return text.replace(/https?:\/\/[^\s<>"']+/gi, ' ');
}

/**
 * Phase 3: Fallback scan over all words in stripped plain text.
 */
function scanFallback(strippedText, existingCandidates) {
  const candidates = [];
  const words = strippedText.split(/[^A-Za-z0-9-]+/);

  for (const w of words) {
    if (!/^[A-Z0-9-]{3,12}$/i.test(w)) continue;
    if (existingCandidates.some((c) => c.val === w.toUpperCase())) continue;

    const wordIdx = strippedText.indexOf(w);
    if (wordIdx !== -1) {
      const before = strippedText
        .slice(Math.max(0, wordIdx - 50), wordIdx)
        .trim();
      if (/[#$]\s*$/.test(before) || NON_OTP_KEYWORDS.test(before)) continue;
      addCandidate(candidates, w, 3, w);
    }
  }
  return candidates;
}

/**
 * Sort candidates by priority (lower = better), then by length.
 */
function rankCandidates(candidates) {
  candidates.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.val.length - a.val.length;
  });
}

// ── Verification link extraction ──

/**
 * Extract the most likely verification link from HTML email content.
 *
 * Strategy:
 *   1. Collect all <a> href values
 *   2. Filter to only verification-looking URLs
 *   3. Rank by: keyword match quality, position prominence, link text
 *
 * @param {Document} doc - Parsed HTML document.
 * @returns {string|null} The best verification URL, or null.
 */
function extractVerifyLinkFromDoc(doc) {
  const links = doc.querySelectorAll('a[href]');
  const linkCandidates = [];

  for (const a of links) {
    const href = a.getAttribute('href')?.trim();
    if (!href) continue;

    // Skip mailto:, tel:, javascript:, anchor-only links
    if (/^(mailto:|tel:|javascript:|#|data:)/i.test(href)) continue;

    // Must be a valid absolute URL
    if (!/^https?:\/\//i.test(href)) continue;

    if (!isVerificationLink(href)) continue;

    // Score the link based on context
    let score = 0;
    const linkText = (a.textContent || '').trim().toLowerCase();

    // Boost: link text contains verification keywords
    if (
      /(verify|confirm|activate|approve|enable|complete|claim|log.?in|sign.?in|开始|确认|確認|인증|подтвержд|bestätig|vérifi|verific)/i.test(
        linkText
      )
    ) {
      score += 10;
    }

    // Boost: link is styled as a button (common pattern for verify buttons)
    const style = a.getAttribute('style') || '';
    const className = a.getAttribute('class') || '';
    if (
      /button|btn|primary|cta|action/i.test(className) ||
      /button|btn/i.test(style) ||
      /display:\s*block|display:\s*inline-block/i.test(style)
    ) {
      score += 5;
    }

    // Boost: link is in a prominent position (early in document)
    const rect = a.getBoundingClientRect?.();
    // Can't getBoundingClientRect on parsed doc, so use DOM position
    const allLinks = [...links];
    const linkIndex = allLinks.indexOf(a);
    if (linkIndex <= 2) score += 3; // First 3 links get a boost

    // Boost: URL path contains strong verification keywords
    try {
      const u = new URL(href);
      const path = u.pathname.toLowerCase();
      if (/(verify|confirm|activate|validate)/.test(path)) score += 5;
      // Penalize if it looks like an API/tracking endpoint
      if (/api\/|\/webhook|\/pixel|\/track/i.test(path)) score -= 10;
    } catch {
      // ignore
    }

    // Boost: token/code parameter is present and substantial
    try {
      const u = new URL(href);
      for (const [key, value] of u.searchParams) {
        const lk = key.toLowerCase();
        if (
          (lk === 'token' || lk === 'code' || lk === 'hash') &&
          value &&
          value.length >= 8
        ) {
          score += 3;
        }
      }
    } catch {
      // ignore
    }

    if (score > 0) {
      linkCandidates.push({ url: href, score });
    }
  }

  if (linkCandidates.length === 0) return null;

  // Return highest-scoring link
  linkCandidates.sort((a, b) => b.score - a.score);
  return linkCandidates[0].url;
}

// ── Public API ──

/**
 * Extract the most likely OTP / verification code from text.
 * @param {string} text - Raw email text (may contain HTML).
 * @returns {string|null} The extracted code, or null if none found.
 */
export function extractOTP(text) {
  if (!text) return null;

  let doc;
  try {
    const parser = new DOMParser();
    doc = parser.parseFromString(text, 'text/html');
  } catch (e) {
    console.error('DOMParser error:', e);
    return null;
  }

  // Phase 1: Prominent elements
  const allCandidates = scanProminentElements(doc);

  // Phase 1b: Split-digit detection
  allCandidates.push(...scanSplitDigits(doc));

  // Extract plain text and strip URLs to prevent false positives
  const rawText = doc.body
    ? doc.body.textContent.replace(/\s+/g, ' ').trim()
    : '';
  const strippedText = stripUrls(rawText);

  // Phase 2: Keyword proximity
  allCandidates.push(...scanKeywordProximity(strippedText));

  // Phase 3: Fallback scan
  allCandidates.push(...scanFallback(strippedText, allCandidates));

  // Rank and return best candidate
  rankCandidates(allCandidates);
  return allCandidates.length > 0 ? allCandidates[0].val : null;
}

/**
 * Extract the most likely verification link from HTML email content.
 * @param {string} text - Raw email HTML.
 * @returns {string|null} The best verification URL, or null.
 */
export function extractVerifyLink(text) {
  if (!text) return null;

  let doc;
  try {
    const parser = new DOMParser();
    doc = parser.parseFromString(text, 'text/html');
  } catch (e) {
    console.error('DOMParser error:', e);
    return null;
  }

  return extractVerifyLinkFromDoc(doc);
}

/**
 * Extract both OTP code and verification link from email content.
 * @param {string} text - Raw email text (may contain HTML).
 * @returns {{ otp: string|null, link: string|null }}
 */
export function extractVerification(text) {
  if (!text) return { otp: null, link: null };

  let doc;
  try {
    const parser = new DOMParser();
    doc = parser.parseFromString(text, 'text/html');
  } catch (e) {
    console.error('DOMParser error:', e);
    return { otp: null, link: null };
  }

  // OTP extraction (reuse parsed doc)
  const allCandidates = scanProminentElements(doc);
  allCandidates.push(...scanSplitDigits(doc));

  const rawText = doc.body
    ? doc.body.textContent.replace(/\s+/g, ' ').trim()
    : '';
  const strippedText = stripUrls(rawText);

  allCandidates.push(...scanKeywordProximity(strippedText));
  allCandidates.push(...scanFallback(strippedText, allCandidates));

  rankCandidates(allCandidates);
  const otp = allCandidates.length > 0 ? allCandidates[0].val : null;

  // Link extraction
  const link = extractVerifyLinkFromDoc(doc);

  return { otp, link };
}
