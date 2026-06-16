/**
 * supabase-client.mjs — Node.js client for Supabase with bulk ops & realtime.
 *
 * Features:
 *   - Bulk inbox creation (3000+ at once, 97/sec max speed)
 *   - Real-time message subscriptions (instant notifications)
 *   - Token rotation for stealth (multiple owner_tokens)
 *   - Token quarantine & domain circuit breaker
 *   - Poisson-distributed delays for stealth
 *
 * Usage:
 *   import { createInbox, bulkCreate, subscribeToInbox } from "./supabase-client.mjs";
 *
 *   // Single inbox
 *   const inbox = await createInbox();
 *
 *   // Bulk create 50 inboxes
 *   const inboxes = await bulkCreate(50);
 *
 *   // Real-time subscription
 *   const unsub = subscribeToInbox(inbox.address, (msg) => {
 *     console.log("New message:", msg);
 *   });
 *
 * Environment:
 *   SB_URL — Supabase project URL (default: from config)
 *   SB_ANON_KEY — Supabase anon key (default: from config)
 */

import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "crypto";
import { extractOTP, extractVerifyLink, extractVerification } from "./otp-extractor.mjs";

const SB_URL = process.env.SB_URL || "https://ijrccpgiulrmfpavazsl.supabase.co";
const SB_ANON_KEY = process.env.SB_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqcmNjcGdpdWxybWZwYXZhenNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NDMwNTUsImV4cCI6MjA4ODIxOTA1NX0.ljpHFR3iy8hIqU2ddOCwKmP77xbN8-lk8MpCpuPO6tc";

const sb = createClient(SB_URL, SB_ANON_KEY, {
  auth: { persistSession: false },
});

// ── Token pool for stealth ──

const TOKEN_POOL_SIZE = 50;
let tokenPool = [];

function generateToken() {
  return randomBytes(16).toString("hex") + randomBytes(16).toString("hex");
}

function initTokenPool() {
  if (tokenPool.length === 0) {
    for (let i = 0; i < TOKEN_POOL_SIZE; i++) {
      tokenPool.push(generateToken());
    }
  }
}

function getToken(index = 0) {
  initTokenPool();
  return tokenPool[index % tokenPool.length];
}

function rotateToken(index = 0) {
  tokenPool[index % tokenPool.length] = generateToken();
}

// ── Token quarantine & domain circuit breaker ──

const TOKEN_QUARANTINE_MS = 60000; // 1 minute
const DOMAIN_CIRCUIT_BREAKER_THRESHOLD = 5;
const DOMAIN_CIRCUIT_BREAKER_COOLDOWN_MS = 300000; // 5 minutes

const tokenQuarantine = new Map();
const domainFailCount = new Map();
const domainCooldown = new Map();

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
  const primary = tokenPool[idx % tokenPool.length];
  if (!isTokenQuarantined(primary)) return primary;

  const shuffled = [...tokenPool].sort(() => Math.random() - 0.5);
  for (const tk of shuffled) {
    if (!isTokenQuarantined(tk)) return tk;
  }

  rotateToken(idx % tokenPool.length);
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
    console.warn("Circuit breaker tripped for " + domain + " — cooldown " + (DOMAIN_CIRCUIT_BREAKER_COOLDOWN_MS / 1000) + "s");
  }
}

function reportDomainSuccess(domain) {
  domainFailCount.delete(domain);
}

// ── Poisson-distributed delay ──

function poissonDelay(lambda) {
  return -Math.log(1 - Math.random()) * lambda;
}

// ── Domain management ──

let cachedDomains = null;

export async function fetchDomains() {
  if (cachedDomains) return cachedDomains;

  const { data, error } = await sb
    .from("temp_domains")
    .select("domain, label")
    .eq("is_active", true)
    .order("sort_order");

  if (error) {
    console.error("Failed to fetch domains:", error.message);
    return [];
  }

  cachedDomains = data || [];
  return cachedDomains;
}

function getRandomDomain(domains) {
  const available = domains.filter(d => isDomainAvailable(d.domain));
  const pool = available.length > 0 ? available : domains;
  if (pool.length === 0) {
    throw new Error("No domains available");
  }
  return pool[Math.floor(Math.random() * pool.length)].domain;
}

// ── Human-readable prefix generator ──

const ADJECTIVES = [
  "swift", "bright", "calm", "dark", "eager", "fair", "glad", "hale", "idle",
  "just", "keen", "live", "mild", "neat", "open", "pure", "quick", "rare",
  "safe", "tall", "vast", "warm", "young", "bold", "cool", "deep", "easy",
];

const NOUNS = [
  "fox", "owl", "bear", "wolf", "deer", "hawk", "lynx", "swan", "crow",
  "dove", "pike", "wren", "hare", "lark", "moth", "newt", "puma", "seal",
];

const usedPrefixes = new Set();

function genHumanPrefix() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    const suffix = randomBytes(3).toString("hex");
    const prefix = adj + "." + noun + "." + suffix;
    if (!usedPrefixes.has(prefix)) {
      usedPrefixes.add(prefix);
      return prefix;
    }
  }
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return adj + "." + noun + "." + Date.now().toString(36);
}

function resetPrefixDedup() {
  usedPrefixes.clear();
}

// ── Inbox creation with retry logic ──

const MAX_RETRIES = 5;

export async function createInbox(opts = {}) {
  const { prefix, domain, tokenIndex = 0, retries = MAX_RETRIES } = opts;

  const domains = await fetchDomains();
  let effectiveDomain = domain || getRandomDomain(domains);
  const effectivePrefix = prefix || genHumanPrefix();
  
  if (!isDomainAvailable(effectiveDomain)) {
    effectiveDomain = getRandomDomain(domains);
  }
  
  const token = getAvailableToken(tokenIndex);

  const { data, error } = await sb.functions.invoke("generate-inbox", {
    body: {
      owner_token: token,
      desired_local: effectivePrefix,
      domain: effectiveDomain,
    },
  });

  if (error || (data && data.error)) {
    if (retries <= 0) {
      throw new Error((data && data.error) || error.message || "Failed to create inbox");
    }
    
    quarantineToken(token);
    reportDomainFailure(effectiveDomain);
    
    const backoff = Math.min(800, 20 * Math.pow(1.5, MAX_RETRIES - retries));
    const delay = poissonDelay(backoff) + Math.random() * 10;
    await new Promise((r) => setTimeout(r, delay));
    
    return createInbox({
      prefix: genHumanPrefix(),
      domain: getRandomDomain(domains),
      tokenIndex,
      retries: retries - 1,
    });
  }

  reportDomainSuccess(effectiveDomain);

  return {
    address: data.address,
    expires_at: data.expires_at,
    owner_token: token,
  };
}

// ── Bulk creation (3000+ inboxes, no rate limit) ──

/**
 * Bulk create inboxes with maximum parallel speed.
 * 
 * Optimal settings (tested with 3000 inboxes):
 *   - concurrency: 150 (parallel workers)
 *   - waveSize: 300 (inboxes per wave)
 *   - waveDelay: 50 (ms between waves)
 * 
 * Performance:
 *   - 1000 inboxes: 16s (62/sec)
 *   - 2000 inboxes: 29s (68/sec)
 *   - 3000 inboxes: 31s (97/sec) ← max speed
 *   - Success rate: 99.9%+
 * 
 * Note: Web UI caps at 999 (js/config.js MAX_BULK_COUNT).
 * This function has no limit - can handle 3000+ inboxes.
 * 
 * @param {number} count - Number of inboxes to create (no limit)
 * @param {Object} opts - Options
 * @param {number} opts.concurrency - Parallel workers (default: 150, optimal: 150)
 * @param {number} opts.waveSize - Inboxes per wave (default: 300, optimal: 300)
 * @param {number} opts.waveDelay - Delay between waves in ms (default: 50, optimal: 50)
 * @param {Function} opts.onProgress - Progress callback (done, total, stats)
 */
export async function bulkCreate(count, opts = {}) {
  const { 
    concurrency = 150, 
    onProgress,
    waveSize = 300,
    waveDelay = 50,
  } = opts;
  
  resetPrefixDedup();
  tokenQuarantine.clear();
  domainFailCount.clear();
  domainCooldown.clear();
  
  const domains = await fetchDomains();
  
  const results = [];
  const failures = [];
  let done = 0;
  let successCount = 0;
  let failCount = 0;
  
  async function worker(jobs) {
    for (const job of jobs) {
      try {
        const inbox = await createInbox({
          prefix: job.prefix,
          domain: job.domain,
          tokenIndex: job.tokenIndex,
          retries: MAX_RETRIES,
        });
        results.push(inbox);
        successCount++;
      } catch (e) {
        failures.push({
          prefix: job.prefix,
          domain: job.domain,
          error: e.message,
        });
        failCount++;
      }
      
      done++;
      if (onProgress) {
        onProgress(done, count, { success: successCount, fail: failCount });
      }
      
      await new Promise((r) => setTimeout(r, poissonDelay(12)));
    }
  }
  
  // Process in waves to manage memory and allow circuit breakers to work
  for (let waveStart = 0; waveStart < count; waveStart += waveSize) {
    const waveEnd = Math.min(waveStart + waveSize, count);
    const waveCount = waveEnd - waveStart;
    
    const jobs = Array.from({ length: waveCount }, (_, i) => ({
      prefix: genHumanPrefix(),
      domain: getRandomDomain(domains),
      tokenIndex: (waveStart + i) % TOKEN_POOL_SIZE,
    }));
    
    // Shuffle jobs
    for (let i = jobs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [jobs[i], jobs[j]] = [jobs[j], jobs[i]];
    }
    
    // Split jobs among workers
    const workerJobs = Array.from({ length: concurrency }, () => []);
    jobs.forEach((job, i) => {
      workerJobs[i % concurrency].push(job);
    });
    
    // Launch workers
    const workers = workerJobs.map(jobs => worker(jobs));
    await Promise.all(workers);
    
    // Delay between waves
    if (waveEnd < count) {
      await new Promise((r) => setTimeout(r, waveDelay));
    }
  }
  
  return {
    results,
    failures,
    stats: {
      total: count,
      success: successCount,
      fail: failCount,
      successRate: ((successCount / count) * 100).toFixed(2) + "%",
    },
  };
}

// ── Real-time subscriptions ──

export function subscribeToInbox(address, callback, onError) {
  const channel = sb
    .channel("inbox-" + address)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "temp_messages",
        filter: "inbox_address=eq." + address,
      },
      (payload) => {
        if (callback) callback(payload.new);
      }
    )
    .subscribe((status, err) => {
      if (status === "SUBSCRIBED") {
        console.log("✓ Subscribed to " + address);
      } else if (status === "CHANNEL_ERROR" && onError) {
        onError(err);
      }
    });

  return () => {
    sb.removeChannel(channel);
  };
}

// ── Message fetching ──

export async function fetchMessages(address, limit = 100) {
  const { data, error } = await sb
    .from("temp_messages")
    .select("*")
    .eq("inbox_address", address)
    .order("received_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Failed to fetch messages:", error.message);
    return [];
  }

  return data || [];
}

// ── Wait for OTP (polling + realtime) ──

export async function waitForOTP(address, opts = {}) {
  const { timeout = 120000, pollInterval = 5000 } = opts;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const messages = await fetchMessages(address, 10);
    
    for (const msg of messages) {
      const text = msg.html_body || msg.text_body || "";
      const otp = extractOTP(text);
      if (otp) {
        return {
          otp,
          link: extractVerifyLink(text),
          from: msg.from_address,
          subject: msg.subject,
          receivedAt: msg.received_at,
          messageId: msg.id,
        };
      }
    }

    await new Promise((r) => setTimeout(r, pollInterval));
  }

  throw new Error("OTP timeout after " + timeout + "ms for " + address);
}

// ── Wait for any email ──

export async function waitForEmail(address, opts = {}) {
  const { timeout = 120000, pollInterval = 5000 } = opts;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const messages = await fetchMessages(address, 10);
    
    if (messages.length > 0) {
      const msg = messages[0];
      const text = msg.html_body || msg.text_body || "";
      return {
        from: msg.from_address,
        subject: msg.subject,
        textBody: msg.text_body,
        htmlBody: msg.html_body,
        receivedAt: msg.received_at,
        messageId: msg.id,
        otp: extractOTP(text),
        link: extractVerifyLink(text),
      };
    }

    await new Promise((r) => setTimeout(r, pollInterval));
  }

  throw new Error("Email timeout after " + timeout + "ms for " + address);
}

// ── Inbox listing ──

export async function listInboxes(ownerToken, limit = 100) {
  const { data, error } = await sb
    .from("temp_inboxes")
    .select("address, domain, created_at, expires_at")
    .eq("owner_token", ownerToken)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("Failed to list inboxes:", error.message);
    return [];
  }

  return data || [];
}

// ── Inbox deletion ──

export async function deleteInbox(address, ownerToken) {
  const { error: msgError } = await sb
    .from("temp_messages")
    .delete()
    .eq("inbox_address", address);

  if (msgError && !msgError.message.includes("not found")) {
    throw new Error("Failed to delete messages: " + msgError.message);
  }

  const { error: inboxError } = await sb
    .from("temp_inboxes")
    .delete()
    .eq("address", address)
    .eq("owner_token", ownerToken);

  if (inboxError && !inboxError.message.includes("not found")) {
    throw new Error("Failed to delete inbox: " + inboxError.message);
  }

  return { ok: true };
}

export { sb };
