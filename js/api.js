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
  FINGERPRINT_PROFILES,
  ACCEPT_TYPES,
  FAKE_REFERERS,
  TOKEN_QUARANTINE_MS,
  DOMAIN_CIRCUIT_BREAKER_THRESHOLD,
  DOMAIN_CIRCUIT_BREAKER_COOLDOWN_MS,
  genHumanPrefix,
  resetPrefixDedup,
} from './config.js';

import {
  domains,
  selectedDomain,
  ownerToken,
  tokenPool,
  rotateOwnerToken,
  rotatePoolToken,
  saveTokenPool,
} from './state.js';

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
  const { data, error } = await sb.functions.invoke('generate-inbox', {
    body: { owner_token: ownerToken, desired_local: prefix, domain },
  });

  if (error || data?.error) {
    if (retries <= 0) {
      throw new Error(data?.error || error?.message || 'Failed to create inbox');
    }
    rotateOwnerToken();
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return createInbox(prefix, domain, retries - 1);
  }

  return { address: data.address, expires_at: data.expires_at };
}

// ── Inbox creation (bulk — max-aggressive stealth pipeline) ──

const SB_FUNC_URL = `${SB_URL}/functions/v1/generate-inbox`;

// ── Token quarantine & domain circuit breaker state ──

const tokenQuarantine = new Map();     // token → cooldown expiry timestamp
const domainFailCount = new Map();     // domain → consecutive failure count
const domainCooldown = new Map();      // domain → cooldown expiry timestamp

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

// ── Poisson-distributed delay (models natural arrival patterns) ──

function poissonDelay(lambda) {
  // Exponential inter-arrival time with mean = lambda ms
  return -Math.log(1 - Math.random()) * lambda;
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
  // Pick a random fingerprint profile for this request
  const profile = FINGERPRINT_PROFILES[Math.floor(Math.random() * FINGERPRINT_PROFILES.length)];

  // Multi-layer cache-busting: timestamp + random nonce + profile hash
  const bust = `_cb=${Date.now()}_${Math.random().toString(36).slice(2, 10)}_${profile.platform.slice(0, 3)}`;
  const url = `${SB_FUNC_URL}?${bust}`;

  const headers = buildStealthHeaders(profile);
  const body = buildBodyWithPadding(prefix, domain, token);

  // Randomize fetch options
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body,
    cache: 'no-store',
    mode: 'cors',
    credentials: Math.random() > 0.5 ? 'omit' : 'same-origin',
    keepalive: Math.random() > 0.7,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || data.message || `HTTP ${res.status}`);
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
      quarantineToken(tk);
      reportDomainFailure(domain);
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

  // Pre-generate unique prefixes and domain assignments
  const prefixes = Array.from({ length: count }, () => genHumanPrefix());
  let domainsForJobs;
  if (targetDomain && domains.some(d => d.domain === targetDomain)) {
    domainsForJobs = Array.from({ length: count }, () => targetDomain);
  } else {
    const availableDomains = domains.filter(
      (d) => !BULK_BLACKLIST.some(b => d.domain.includes(b)) && isDomainAvailable(d.domain)
    );
    const domList = availableDomains.length > 0 ? availableDomains : domains;
    domainsForJobs = Array.from({ length: count }, () =>
      domList[Math.floor(Math.random() * domList.length)]?.domain
    );
  }

  // Shuffle job order to avoid predictable sequences
  const jobIndices = Array.from({ length: count }, (_, i) => i);
  for (let i = jobIndices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [jobIndices[i], jobIndices[j]] = [jobIndices[j], jobIndices[i]];
  }

  const results = [];
  const concurrency = Math.min(count, BULK_CONCURRENCY);
  let done = 0;
  let idx = 0;

  async function worker(workerId) {
    // Staggered startup — each worker starts at a Poisson-distributed offset
    await new Promise((r) => setTimeout(r, poissonDelay(25)));

    while (true) {
      const i = idx++;
      if (i >= count) break;
      const realIdx = jobIndices[i];

      const r = await tryCreateInbox(
        prefixes[realIdx],
        domainsForJobs[realIdx],
        realIdx % tokenPool.length
      );
      if (r) results.push(r);
      done++;
      onProgress(done, count);

      // Poisson-distributed inter-request delay (mean ~40ms)
      // This creates natural-looking traffic instead of uniform bursts
      await new Promise((r) => setTimeout(r, poissonDelay(12)));
    }
  }

  await Promise.all(
    Array.from({ length: concurrency }, (_, i) => worker(i))
  );
  saveTokenPool();
  return results;
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

// ── Inbox deletion (via REST API) ──

const TEMP_MAIL_API_URL = 'https://ijrccpgiulrmfpavazsl.supabase.co/functions/v1/temp-mail-api';

/**
 * Delete an inbox and all its messages via the REST API.
 * Requires an API key (tmk_ format).
 *
 * @param {string} address - Inbox email address.
 * @param {string} ownerTokenArg - Owner token for the inbox.
 * @param {string} apiKey - REST API key.
 * @returns {Promise<{ok: boolean}>}
 */
export async function deleteInboxViaApi(address, ownerTokenArg, apiKey) {
  const res = await fetch(`${TEMP_MAIL_API_URL}?action=delete`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ address, owner_token: ownerTokenArg }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Delete failed: HTTP ${res.status}`);
  }

  return { ok: true };
}
