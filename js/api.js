/**
 * api.js — Supabase client, inbox generation, and message fetching.
 *
 * All network calls live here. Uses the Supabase JS client for
 * standard CRUD and realtime subscriptions.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  SB_URL,
  SB_ANON_KEY,
  MAX_GEN_RETRIES,
  RETRY_DELAY_MS,
  MESSAGE_FETCH_LIMIT,
  BULK_CONCURRENCY,
  BULK_BLACKLIST,
  PREMIUM_DOMAINS,
  DOMAIN_CIRCUIT_BREAKER_THRESHOLD,
  DOMAIN_CIRCUIT_BREAKER_COOLDOWN_MS,
  genHumanPrefix,
  generateInboxPassword,
  resetPrefixDedup,
} from './config.js';

import {
  domains,
  selectedDomain,
  ownerToken,
  rotateOwnerToken,
  saveVipPassword,
} from './state.js';

// ── Supabase client ──

export const sb = createClient(SB_URL, SB_ANON_KEY, {
  auth: { persistSession: false },
});

// ── Helpers ──

export function getEffDomain() {
  if (!selectedDomain || selectedDomain === '__random__') {
    return domains[Math.floor(Math.random() * domains.length)]?.domain || '';
  }
  return domains.some((d) => d.domain === selectedDomain)
    ? selectedDomain
    : domains[Math.floor(Math.random() * domains.length)]?.domain || '';
}

// ── Load available domains ──

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

// ── Inbox creation (standard) ──

export async function createInbox(prefix, domain, retries = MAX_GEN_RETRIES) {
  if (PREMIUM_DOMAINS.includes(domain)) {
    return createVipInbox(prefix, domain);
  }

  const { data, error } = await sb.functions.invoke('generate-inbox', {
    body: { owner_token: ownerToken, desired_local: prefix, domain },
  });

  if (error || data?.error) {
    if (isVipDomainError({ message: data?.error || error?.message || '' })) {
      return createVipInbox(prefix, domain);
    }
    if (retries <= 0) {
      throw new Error(data?.error || error?.message || 'Failed to create inbox');
    }
    rotateOwnerToken();
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    return createInbox(prefix, domain, retries - 1);
  }

  return { address: data.address, expires_at: data.expires_at };
}

// ── Bulk inbox creation (concurrent workers) ──

const domainFailCount = new Map();
const domainCooldown = new Map();

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

function isVipDomainError(error) {
  return /khusus\s+vip|vip|row.level.security|rls|policy|is_vip/i.test(error?.message || '');
}

export async function bulkCreateInboxes(count, onProgress, targetDomain) {
  resetPrefixDedup();
  domainFailCount.clear();
  domainCooldown.clear();

  const results = [];
  const failures = [];
  const concurrency = Math.min(count, BULK_CONCURRENCY);
  let nextIndex = 0;

  function pickDomain() {
    if (targetDomain && domains.some((d) => d.domain === targetDomain) && isDomainAvailable(targetDomain)) {
      return targetDomain;
    }
    const available = domains.filter(
      (d) => !BULK_BLACKLIST.some((b) => d.domain.includes(b)) && !PREMIUM_DOMAINS.includes(d.domain) && isDomainAvailable(d.domain)
    );
    const pool = available.length > 0 ? available : domains.filter(
      (d) => !BULK_BLACKLIST.some((b) => d.domain.includes(b)) && !PREMIUM_DOMAINS.includes(d.domain)
    );
    if (pool.length === 0) return targetDomain || domains[0]?.domain || '';
    return pool[Math.floor(Math.random() * pool.length)]?.domain || '';
  }

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= count) break;

      const prefix = genHumanPrefix();
      const domain = pickDomain();

      try {
        const result = await createInbox(prefix, domain);
        results.push(result);
        reportDomainSuccess(domain);
      } catch (e) {
        if (isVipDomainError(e)) {
          try {
            const vip = await createVipInbox(prefix, domain);
            results.push(vip);
            continue;
          } catch {}
        }
        reportDomainFailure(domain);
        failures.push({ prefix, domain, error: e.message });
      }

      onProgress(Math.min(results.length, count), count);
    }
  }

  await Promise.all(
    Array.from({ length: concurrency }, () => worker())
  );

  if (results.length < count) {
    console.warn(`Bulk creation completed ${results.length}/${count}; ${failures.length} failures`);
  }
  return results.slice(0, count);
}

// ── Message fetching ──

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

// ── Inbox deletion ──

export async function deleteInbox(address, ownerTokenArg) {
  const { error: msgError } = await sb
    .from('temp_messages')
    .delete()
    .eq('inbox_address', address);

  if (msgError && !msgError.message.includes('not found')) {
    throw new Error('Failed to delete messages: ' + msgError.message);
  }

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

// ── VIP Inbox Creation (RLS-resilient) ──
// Never sends is_vip:true in the INSERT — a future RLS policy could block it.
// Fallback chain: Path 1 (skip flag) → Path 2 (insert-then-update)
// Server-side upgrades (when Supabase dashboard is available):
//   Path 3: SECURITY DEFINER RPC — sb.rpc('create_vip_inbox', {...})
//   Path 4: Separate temp_vip_credentials table
//   Path 5: Edge function allowlist (service_role bypasses anon RLS)

async function trySetVipFlag(address) {
  const { error } = await sb
    .from('temp_inboxes')
    .update({ is_vip: true })
    .eq('address', address)
    .eq('owner_token', ownerToken);
  return !error;
}

export async function createVipInbox(prefix, domain) {
  const password = generateInboxPassword();
  const targetDomain = domain || getEffDomain();

  for (let attempt = 0; attempt < MAX_GEN_RETRIES; attempt++) {
    const local = (attempt === 0 && prefix ? prefix : genHumanPrefix())
      .toLowerCase()
      .replace(/[^a-z0-9._-]/g, '');
    const address = `${local}@${targetDomain}`;

    const { data, error } = await sb
      .from('temp_inboxes')
      .insert({
        address,
        domain: targetDomain,
        owner_token: ownerToken,
        password_plain: password,
      })
      .select('address, expires_at, password_plain')
      .single();

    if (!error) {
      await trySetVipFlag(address);
      data.is_vip = true;
      saveVipPassword(address, password);
      return data;
    }
    if (!/duplicate|already exists|unique/i.test(error.message || '')) {
      throw new Error(error.message || 'Failed to create VIP inbox');
    }
  }

  throw new Error('Failed to create VIP inbox: duplicate prefixes exhausted');
}

export async function bulkCreateVipInboxes(count, opts = {}) {
  const { domain, concurrency = 10, onProgress } = opts;
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
        const inbox = await createVipInbox(genHumanPrefix(), pickDomain());
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
