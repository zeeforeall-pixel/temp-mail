/**
 * api.js — Supabase client, inbox generation, and message fetching.
 *
 * All network calls live here. Uses direct fetch for bulk creation
 * (to enable stealth headers and cache-busting) and the Supabase JS
 * client for standard CRUD and realtime subscriptions.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  SB_URL,
  SB_ANON_KEY,
  MAX_INBOX_RETRIES,
  MAX_GEN_RETRIES,
  RETRY_DELAY_MS,
  MESSAGE_FETCH_LIMIT,
  BULK_CONCURRENCY,
  BULK_BLACKLIST,
  PREMIUM_DOMAINS,
  FINGERPRINT_PROFILES,
  ACCEPT_TYPES,
  FAKE_REFERERS,
  TOKEN_QUARANTINE_MS,
  DOMAIN_CIRCUIT_BREAKER_THRESHOLD,
  DOMAIN_CIRCUIT_BREAKER_COOLDOWN_MS,
  genHumanPrefix,
  generateInboxPassword,
  resetPrefixDedup,
} from './config.js?v=1781748237';

import {
  domains,
  selectedDomain,
  ownerToken,
  tokenPool,
  rotateOwnerToken,
  rotatePoolToken,
  saveTokenPool,
} from './state.js?v=1781748237';

// ── Supabase client ──

export const sb = createClient(SB_URL, SB_ANON_KEY, {
  auth: { persistSession: false },
});

// ── Helpers ──

/**
 * Pick the effective domain: the selected one if valid, else random.
 */
export function getEffDomain() {
  if (!selectedDomain || selectedDomain === '__random__') {
    return domains[Math.floor(Math.random() * domains.length)]?.domain || '';
  }
  return domains.some((d) => d.domain === selectedDomain)
    ? selectedDomain
    : domains[Math.floor(Math.random() * domains.length)]?.domain || '';
}

// ── Load available domains ──

/**
 * Fetch active domains from the database.
 * @returns {Promise<Array>} Array of { domain, label } objects.
 */
export async function fetchDomains() {
  const { data, error } = await sb
    .from('temp_domains')
    .select('domain, label')
    .eq('is_active', true)
    .order('sort_order');

  if (error) {
    console.warn('Failed to load domains:', error.message);
    return [];
  }
  return data || [];
}

// ── Inbox creation (standard — via Supabase Edge Function) ──

/**
 * Create an inbox using the Supabase JS client.
 * Used for single manual/random creation.
 *
 * @param {string} prefix - Desired local part of the email.
 * @param {string} domain - Domain to use.
 * @param {number} retries - Remaining retry attempts.
 * @returns {Promise<{address: string, expires_at: string}|null>}
 */
export async function createInbox(prefix, domain, retries = MAX_GEN_RETRIES) {
  if (PREMIUM_DOMAINS.includes(domain)) {
    return createVipInbox(prefix, domain);
  }

  try {
    const res = await fetch('/api/create-inbox', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ owner_token: ownerToken, desired_local: prefix, domain }),
    });

    const data = await res.json();
    if (!res.ok || data?.error) {
      if (isVipDomainError({ message: data?.error || '' })) {
        return createVipInbox(prefix, domain);
      }
      if (retries <= 0) {
        throw new Error(data?.error || 'Failed to create inbox');
      }
      rotateOwnerToken();
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      return createInbox(prefix, domain, retries - 1);
    }

    return { address: data.address, expires_at: data.expires_at };
  } catch (err) {
    if (retries <= 0) throw err;
    rotateOwnerToken();
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return createInbox(prefix, domain, retries - 1);
  }
}

// ── Inbox creation (bulk — max-aggressive stealth pipeline) ──

const SB_FUNC_URL = `${SB_URL}/functions/v1/generate-inbox`;

// ── Token quarantine & domain circuit breaker state ──

const tokenQuarantine = new Map();     // token → cooldown expiry timestamp
const domainFailCount = new Map();     // domain → consecutive failure count
const domainCooldown = new Map();      // domain → cooldown expiry timestamp
let bulkThrottleMs = 0;
let bulkThrottleUntil = 0;

function isTokenQuarantined(token) {
  const until = tokenQuarantine.get(token);
  if (!until) return false;
  if (Date.now() >= until) {
    tokenQuarantine.delete(token);
    return false;
  }
  return true;
}

function quarantineToken(token) {
  tokenQuarantine.set(token, Date.now() + TOKEN_QUARANTINE_MS);
}

function getAvailableToken(idx) {
  // Try the assigned token first, then scan the pool for a non-quarantined one
  const primary = tokenPool[idx % tokenPool.length];
  if (!isTokenQuarantined(primary)) return primary;

  // Scan pool for any available token
  const shuffled = [...tokenPool].sort(() => Math.random() - 0.5);
  for (const tk of shuffled) {
    if (!isTokenQuarantined(tk)) return tk;
  }
  // All quarantined — rotate a fresh one
  rotatePoolToken(idx % tokenPool.length);
  return tokenPool[idx % tokenPool.length];
}

function isDomainAvailable(domain) {
  const until = domainCooldown.get(domain);
  if (!until) return true;
  if (Date.now() >= until) {
    domainCooldown.delete(domain);
    domainFailCount.delete(domain);
    return true;
  }
  return false;
}

function reportDomainFailure(domain) {
  const count = (domainFailCount.get(domain) || 0) + 1;
  domainFailCount.set(domain, count);
  if (count >= DOMAIN_CIRCUIT_BREAKER_THRESHOLD) {
    domainCooldown.set(domain, Date.now() + DOMAIN_CIRCUIT_BREAKER_COOLDOWN_MS);
    console.warn(`Circuit breaker tripped for ${domain} — cooldown ${DOMAIN_CIRCUIT_BREAKER_COOLDOWN_MS / 1000}s`);
  }
}

function reportDomainSuccess(domain) {
  domainFailCount.delete(domain);
}

async function waitForBulkThrottle() {
  const waitMs = bulkThrottleUntil - Date.now();
  if (waitMs > 0) {
    await new Promise((r) => setTimeout(r, waitMs + poissonDelay(25)));
  }
}

function reportBulkRateLimit() {
  bulkThrottleMs = Math.min(3000, Math.max(250, bulkThrottleMs * 1.5 || 250));
  bulkThrottleUntil = Date.now() + bulkThrottleMs;
}

function reportBulkSuccess() {
  bulkThrottleMs = Math.max(0, bulkThrottleMs * 0.85 - 25);
  if (bulkThrottleMs === 0) bulkThrottleUntil = 0;
}

// ── Poisson-distributed delay (models natural arrival patterns) ──

function poissonDelay(lambda) {
  // Exponential inter-arrival time with mean = lambda ms
  return -Math.log(1 - Math.random()) * lambda;
}

function isRateLimitError(error) {
  return error?.status === 429 || /rate\s*limit|too many requests/i.test(error?.message || '');
}

function isVipDomainError(error) {
  return /khusus\s+vip|vip|row.level.security|rls|policy|is_vip/i.test(error?.message || '');
}

// ── Build request body with random padding (breaks body fingerprinting) ──

const PADDING_KEYS = [
  '_t', '_r', '_n', '_v', '_x', '_c', '_p', '_q', '_z',
  'nonce', 'ts', 'ref', 'seq', 'client_id', 'session_hint',
];

function buildBodyWithPadding(prefix, domain, token) {
  const body = { owner_token: token, desired_local: prefix, domain };

  // Add 1–3 random padding fields with harmless values
  const padCount = 1 + Math.floor(Math.random() * 3);
  const usedKeys = new Set();
  for (let i = 0; i < padCount; i++) {
    let key;
    do {
      key = PADDING_KEYS[Math.floor(Math.random() * PADDING_KEYS.length)];
    } while (usedKeys.has(key));
    usedKeys.add(key);

    // Mix of value types: numbers, short strings, booleans, timestamps
    const variant = Math.random();
    if (variant < 0.25) body[key] = Date.now() + Math.floor(Math.random() * 1000);
    else if (variant < 0.5) body[key] = Math.random().toString(36).slice(2, 8);
    else if (variant < 0.75) body[key] = Math.random() > 0.5;
    else body[key] = Math.floor(Math.random() * 99999);
  }

  // Randomize key ordering — JSON.stringify preserves insertion order
  const keys = Object.keys(body);
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  const ordered = {};
  for (const k of keys) ordered[k] = body[k];
  return JSON.stringify(ordered);
}

// ── Build stealth headers from a fingerprint profile ──

function buildStealthHeaders(profile) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${SB_ANON_KEY}`,
    apikey: SB_ANON_KEY,
    Accept: ACCEPT_TYPES[Math.floor(Math.random() * ACCEPT_TYPES.length)],
    'Accept-Language': profile.locale,
  };

  // Sec-CH-UA hints (Chrome/Edge only — Safari/Firefox don't send these)
  if (profile.secUA) {
    headers['Sec-CH-UA'] = profile.secUA;
    headers['Sec-CH-UA-Platform'] = profile.secPlatform;
    headers['Sec-CH-UA-Mobile'] = profile.secMobile;
  }

  // Sec-Fetch headers (Chrome/Edge/Firefox — not Safari)
  if (!profile.safari) {
    headers['Sec-Fetch-Mode'] = 'cors';
    headers['Sec-Fetch-Site'] = Math.random() > 0.5 ? 'cross-site' : 'same-site';
    headers['Sec-Fetch-Dest'] = 'empty';
  }

  // Fake Referer (randomly included — ~60% of requests)
  const referer = FAKE_REFERERS[Math.floor(Math.random() * FAKE_REFERERS.length)];
  if (referer) {
    headers['Referer'] = referer;
  }

  // Random extras
  const rand = Math.random();
  if (rand > 0.5) headers['X-Request-Id'] = crypto.randomUUID();
  if (rand > 0.8) headers['X-Forwarded-For'] = generateFakeIP();
  if (rand > 0.9) headers['DNT'] = '1';
  if (rand > 0.85) headers['Accept-Encoding'] = 'gzip, deflate, br';

  return headers;
}

// ── Fake IP generator (for X-Forwarded-For — mostly ignored by servers,
//    but adds entropy to the request fingerprint) ──

function generateFakeIP() {
  const octets = [
    1 + Math.floor(Math.random() * 223),  // avoid 0.x and multicast
    Math.floor(Math.random() * 256),
    Math.floor(Math.random() * 256),
    1 + Math.floor(Math.random() * 254),
  ];
  // Avoid private ranges that would look suspicious
  if (octets[0] === 10 || octets[0] === 127) octets[0] = 44;
  if (octets[0] === 192 && octets[1] === 168) octets[1] = 1;
  return octets.join('.');
}

// ── Fire a single request with full stealth ──

/**
 * Fire a single inbox creation request with maximum stealth.
 * Each request gets a unique fingerprint profile, cache-busted URL,
 * padded body, and randomized headers.
 */
export async function fireInboxRequest(prefix, domain, token) {
  if (PREMIUM_DOMAINS.includes(domain)) {
    return createVipInbox(prefix, domain);
  }

  // Route through Vercel serverless (bypasses Supabase DNS issues from browser)
  const res = await fetch('/api/create-inbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner_token: token, desired_local: prefix, domain }),
  });

  const data = await res.json();
  if (!res.ok) {
    const error = new Error(data.error || `HTTP ${res.status}`);
    error.status = res.status;
    throw error;
  }
  if (data?.error) {
    throw new Error(data.error);
  }
  return { address: data.address, expires_at: data.expires_at };
}

// ── Retry with quarantine + circuit breaker ──

/**
 * Try to create a single inbox with aggressive retry logic.
 * - Tokens that fail get quarantined (temporary cooldown)
 * - Domains that fail repeatedly trigger a circuit breaker
 * - Each retry uses a fresh token and Poisson-distributed backoff
 */
export async function tryCreateInbox(prefix, domain, tokenIdx) {
  if (PREMIUM_DOMAINS.includes(domain)) {
    return createVipInbox(prefix, domain);
  }

  // Check circuit breaker — skip this domain if it's in cooldown
  if (!isDomainAvailable(domain)) {
    // Try a different domain from the pool
    const available = domains.filter(
      (d) => !BULK_BLACKLIST.some(b => d.domain.includes(b)) && isDomainAvailable(d.domain)
    );
    if (available.length > 0) {
      domain = available[Math.floor(Math.random() * available.length)].domain;
    }
  }

  for (let attempt = 0; attempt < MAX_INBOX_RETRIES; attempt++) {
    const p = attempt === 0 ? prefix : genHumanPrefix();
    const tk = attempt === 0
      ? getAvailableToken(tokenIdx)
      : (() => {
          rotatePoolToken(tokenIdx);
          return tokenPool[tokenIdx];
        })();

    try {
      // Poisson-distributed backoff: mean grows exponentially with attempt
      if (attempt > 0) {
        const meanDelay = Math.min(800, 20 * Math.pow(1.5, attempt));
        const delay = poissonDelay(meanDelay) + Math.random() * 10;
        await new Promise((r) => setTimeout(r, delay));
      }
      const result = await fireInboxRequest(p, domain, tk);
      reportDomainSuccess(domain);
      return result;
    } catch (e) {
      if (isVipDomainError(e)) {
        return createVipInbox(p, domain);
      }
      quarantineToken(tk);
      reportDomainFailure(domain);
      if (isRateLimitError(e)) {
        reportBulkRateLimit();
      }
      if (attempt < MAX_INBOX_RETRIES - 1) {
        console.warn(`Attempt ${attempt + 1}/${MAX_INBOX_RETRIES} failed (${e.message}) — quarantined token, retrying`);
      }
    }
  }
  return null;
}

// ── Wave-based bulk dispatch ──

/**
 * Bulk-create inboxes using staggered waves with Poisson timing.
 * Requests are dispatched in waves to avoid burst detection.
 * Each wave has a random size and inter-wave delay.
 */
export async function bulkCreateInboxes(count, onProgress, targetDomain) {
  // Reset dedup set and circuit breakers for a fresh batch
  resetPrefixDedup();
  tokenQuarantine.clear();
  domainFailCount.clear();
  domainCooldown.clear();
  bulkThrottleMs = 0;
  bulkThrottleUntil = 0;

  const results = [];
  const failures = [];
  const concurrency = Math.min(count, BULK_CONCURRENCY);
  let active = 0;
  let attempts = 0;
  const maxAttempts = count + Math.max(BULK_CONCURRENCY, Math.ceil(count * 0.25));

  function pickDomain() {
    if (targetDomain && domains.some((d) => d.domain === targetDomain) && isDomainAvailable(targetDomain)) {
      return targetDomain;
    }

    const availableDomains = domains.filter(
      (d) => !BULK_BLACKLIST.some((b) => d.domain.includes(b)) && !PREMIUM_DOMAINS.includes(d.domain) && isDomainAvailable(d.domain)
    );
    const pool = availableDomains.length > 0 ? availableDomains : domains.filter(
      (d) => !BULK_BLACKLIST.some((b) => d.domain.includes(b)) && !PREMIUM_DOMAINS.includes(d.domain)
    );

    if (pool.length === 0) {
      return targetDomain || domains[0]?.domain || '';
    }

    return pool[Math.floor(Math.random() * pool.length)]?.domain || '';
  }

  function nextJob() {
    if (results.length + active >= count || attempts >= maxAttempts) return null;
    active++;
    attempts++;
    return {
      prefix: genHumanPrefix(),
      domain: pickDomain(),
      tokenIndex: attempts % tokenPool.length,
    };
  }

  async function worker() {
    // Staggered startup — each worker starts at a Poisson-distributed offset
    await new Promise((r) => setTimeout(r, poissonDelay(25)));

    while (true) {
      if (results.length >= count || attempts >= maxAttempts) break;

      const job = nextJob();
      if (!job) break;

      await waitForBulkThrottle();
      const finalPrefix = job.prefix;
      const r = await tryCreateInbox(finalPrefix, job.domain, job.tokenIndex);
      if (r) {
        results.push(r);
        reportBulkSuccess();
      } else {
        failures.push({
          prefix: job.prefix,
          domain: job.domain,
          error: 'exhausted retries',
        });
      }
      active--;
      onProgress(Math.min(results.length, count), count);

      // Poisson-distributed inter-request delay (mean ~40ms)
      // This creates natural-looking traffic instead of uniform bursts
      await new Promise((r) => setTimeout(r, poissonDelay(12)));

      if (results.length >= count) break;
    }
  }

  await Promise.all(
    Array.from({ length: concurrency }, (_, i) => worker(i))
  );
  saveTokenPool();
  if (results.length < count) {
    console.warn(`Bulk inbox creation completed ${results.length}/${count}; ${failures.length} refill attempts exhausted`);
  }
  return results.slice(0, count);
}

// ── Message fetching ──

/**
 * Fetch messages for the current inbox.
 * @param {string} inboxAddress - The inbox email address.
 * @returns {Promise<Array>} Array of message objects.
 */
export async function fetchMessages(inboxAddress) {
  if (!inboxAddress) return [];
  try {
    const { data, error } = await sb
      .from('temp_messages')
      .select('*')
      .eq('inbox_address', inboxAddress)
      .order('received_at', { ascending: false })
      .limit(MESSAGE_FETCH_LIMIT);

    if (error) {
      console.warn('Failed to fetch messages:', error.message);
      return [];
    }
    return data || [];
  } catch (e) {
    console.warn('Message fetch error:', e.message);
    return [];
  }
}

// ── Parallel / batch message fetching ──

/**
 * Fetch messages for multiple inbox addresses in a single query.
 * Uses .in() filter for batch retrieval.
 * @param {string[]} addresses - Array of inbox addresses.
 * @returns {Promise<Map<string, Array>>} Map of address → messages.
 */
export async function fetchMessagesForAddresses(addresses) {
  if (!addresses || addresses.length === 0) return new Map();
  const map = new Map();
  try {
    const { data, error } = await sb
      .from('temp_messages')
      .select('*')
      .in('inbox_address', addresses)
      .order('received_at', { ascending: false })
      .limit(MESSAGE_FETCH_LIMIT * addresses.length);

    if (error) {
      console.warn('Batch message fetch failed:', error.message);
      return map;
    }

    for (const addr of addresses) map.set(addr, []);
    for (const msg of (data || [])) {
      const arr = map.get(msg.inbox_address);
      if (arr) arr.push(msg);
    }
    return map;
  } catch (e) {
    console.warn('Batch message fetch error:', e.message);
    return map;
  }
}

/**
 * Fetch message counts for multiple addresses in a single query.
 * Lighter than fetching full messages — uses count option.
 * @param {string[]} addresses - Array of inbox addresses.
 * @returns {Promise<Map<string, number>>} Map of address → count.
 */
export async function fetchMessageCounts(addresses) {
  if (!addresses || addresses.length === 0) return new Map();
  const map = new Map();
  try {
    const { data, error } = await sb
      .from('temp_messages')
      .select('inbox_address', { count: 'exact', head: true })
      .in('inbox_address', addresses);

    if (error) {
      console.warn('Message count fetch failed:', error.message);
      return map;
    }

    for (const addr of addresses) map.set(addr, 0);

    if (!data || data.length === 0) return map;
    for (const row of data) {
      map.set(row.inbox_address, (map.get(row.inbox_address) || 0) + 1);
    }
    return map;
  } catch (e) {
    console.warn('Message count error:', e.message);
    return map;
  }
}

// ── Shared inbox lookup ──

/**
 * Look up or create an inbox from a shared URL parameter.
 * @param {string} sharedAddress - The shared email address.
 * @returns {Promise<{address: string, expires_at: string}|null>}
 */
export async function lookupSharedInbox(sharedAddress) {
  let { data, error } = await sb
    .from('temp_inboxes')
    .select('address, expires_at')
    .eq('address', sharedAddress)
    .maybeSingle();

  if (error) {
    console.warn('Shared inbox lookup failed:', error.message);
    return null;
  }

  if (!data) {
    const result = await sb
      .from('temp_inboxes')
      .insert({
        address: sharedAddress,
        domain: sharedAddress.split('@')[1],
        owner_token: ownerToken,
      })
      .select('address, expires_at')
      .single();
    if (result.error) {
      console.warn('Failed to create shared inbox:', result.error.message);
      return null;
    }
    data = result.data;
  }

  return data || null;
}


// ── Inbox deletion (via Supabase RLS) ──

/**
 * Delete an inbox and all its messages via Supabase.
 *
 * @param {string} address - Inbox email address.
 * @param {string} ownerTokenArg - Owner token for the inbox.
 * @returns {Promise<{ok: boolean}>}
 */
export async function deleteInbox(address, ownerTokenArg) {
  // Delete messages first (foreign key constraint)
  const { error: msgError } = await sb
    .from('temp_messages')
    .delete()
    .eq('inbox_address', address);

  if (msgError && !msgError.message.includes('not found')) {
    throw new Error('Failed to delete messages: ' + msgError.message);
  }

  // Delete inbox
  const { error: inboxError } = await sb
    .from('temp_inboxes')
    .delete()
    .eq('address', address)
    .eq('owner_token', ownerTokenArg);

  if (inboxError && !inboxError.message.includes('not found')) {
    throw new Error('Failed to delete inbox: ' + inboxError.message);
  }

  return { ok: true };
}

// ── Lifetime Pro Inbox Creation (with auto-generated IMAP/SMTP password) ──

/**
 * Create a Lifetime Pro inbox with an auto-generated password for IMAP/SMTP login.
 * Creates the inbox via edge function, then updates it with password_plain + is_vip.
 *
 * @param {string} prefix - Desired local part of the email.
 * @param {string} domain - Domain to use.
 * @returns {Promise<{address: string, expires_at: string, password_plain: string, is_vip: true}|null>}
 */
export async function createVipInbox(prefix, domain) {
  const targetDomain = domain || getEffDomain();
  const local = (prefix || genHumanPrefix())
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[._-]+|[._-]{2,}|[._-]+$/g, '');

  // Lifetime Pro creation goes through serverless function (server-side, no secrets in client)
  const res = await fetch('/api/create-vip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ owner_token: ownerToken, desired_local: local, domain: targetDomain }),
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error || 'Failed to create Lifetime Pro inbox');
  }

  return {
    address: data.address,
    expires_at: data.expires_at,
    password_plain: data.password,
    is_vip: data.is_vip,
  };
}

export async function bulkCreateVipInboxes(count, opts = {}) {
  const {
    domain,
    concurrency = 10,
    onProgress,
  } = opts;

  const results = [];
  const failures = [];
  let nextIndex = 0;

  function pickDomain() {
    if (domain && domains.some((d) => d.domain === domain)) return domain;
    if (selectedDomain && selectedDomain !== '__random__') return selectedDomain;
    return domains[Math.floor(Math.random() * domains.length)]?.domain || '';
  }

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= count) break;

      try {
        const _prefix = genHumanPrefix();
        const inbox = await createVipInbox(_prefix, pickDomain());
        results.push(inbox);
      } catch (e) {
        failures.push({ index, error: e.message });
      }

      onProgress?.(results.length + failures.length, count, {
        success: results.length,
        fail: failures.length,
      });
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(count, concurrency) }, () => worker())
  );

  return { results, failures };
}
