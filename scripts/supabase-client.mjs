/**
 * supabase-client.mjs — Node.js client for Supabase with bulk ops & realtime.
 *
 * Features:
 *   - Bulk inbox creation (100+ at once, no rate limit)
 *   - Real-time message subscriptions (instant notifications)
 *   - Token rotation for stealth (multiple owner_tokens)
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
  if (!domains || domains.length === 0) {
    throw new Error("No domains available");
  }
  return domains[Math.floor(Math.random() * domains.length)].domain;
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

function genHumanPrefix() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const suffix = randomBytes(3).toString("hex");
  return adj + "." + noun + "." + suffix;
}

// ── Inbox creation ──

export async function createInbox(opts = {}) {
  const { prefix, domain, tokenIndex = 0 } = opts;

  const domains = await fetchDomains();
  const effectiveDomain = domain || getRandomDomain(domains);
  const effectivePrefix = prefix || genHumanPrefix();
  const token = getToken(tokenIndex);

  const { data, error } = await sb.functions.invoke("generate-inbox", {
    body: {
      owner_token: token,
      desired_local: effectivePrefix,
      domain: effectiveDomain,
    },
  });

  if (error) {
    rotateToken(tokenIndex);
    throw new Error(error.message || "Failed to create inbox");
  }

  if (data && data.error) {
    rotateToken(tokenIndex);
    throw new Error(data.error);
  }

  return {
    address: data.address,
    expires_at: data.expires_at,
    owner_token: token,
  };
}

// ── Bulk creation (no rate limit with anon key) ──

export async function bulkCreate(count, opts = {}) {
  const { concurrency = 10, onProgress } = opts;
  const domains = await fetchDomains();

  const jobs = Array.from({ length: count }, (_, i) => ({
    prefix: genHumanPrefix(),
    domain: getRandomDomain(domains),
    tokenIndex: i % TOKEN_POOL_SIZE,
  }));

  const results = [];
  let done = 0;

  async function worker() {
    while (jobs.length > 0) {
      const job = jobs.shift();
      if (!job) break;

      try {
        const inbox = await createInbox({
          prefix: job.prefix,
          domain: job.domain,
          tokenIndex: job.tokenIndex,
        });
        results.push(inbox);
      } catch (e) {
        console.error("Failed to create " + job.prefix + ":", e.message);
      }

      done++;
      if (onProgress) onProgress(done, count);

      // Small delay to avoid overwhelming the server
      await new Promise((r) => setTimeout(r, 10 + Math.random() * 20));
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  return results;
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
