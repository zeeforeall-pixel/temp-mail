/**
 * temp-mail-client.mjs — Node.js REST client for Temp Mail API.
 *
 * Server-side client for automation scripts. Wraps all API endpoints
 * with proper auth headers and includes OTP extraction logic.
 *
 * Usage:
 *   import { createInbox, pollForOTP } from "./scripts/temp-mail-client.mjs";
 *
 *   const inbox = await createInbox({ apiKey: process.env.TM_API_KEY });
 *   console.log("Email:", inbox.address);
 *   const otp = await pollForOTP(inbox.address, inbox.owner_token, { apiKey: process.env.TM_API_KEY });
 *   console.log("OTP:", otp);
 *
 * Environment:
 *   TM_API_KEY - Your API key (tmk_... format)
 */

const BASE_URL = "https://ijrccpgiulrmfpavazsl.supabase.co/functions/v1/temp-mail-api";

const OTP_KEYWORDS = /\b(verification code|verification|one.time password|otp|security code|login code|confirmation code|sign.in code|magic code|access code|two.factor|2fa|mfa|passcode|passkey|activate|register|log.?in|kode verifikasi|kode|pin|code|verify|confirm|token|secret|验证码|確認コード|인증 코드)\b/i;

const NON_OTP_KEYWORDS = /\b(order|ref|reference|invoice|tracking|ticket|total|price|rp|usd|amount|balance|phone|tel|fax|zip|postal|version|qty|quantity|subtotal|discount|product|serial|copyright|january|february|march|april|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|account no|transaction|receipt|statement|balance|payment|transfer|deposit|withdrawal|subscription|membership)\b/i;

async function api(action, opts = {}) {
  const apiKey = opts.apiKey || process.env.TM_API_KEY;
  if (!apiKey) {
    throw new Error("API key required. Set TM_API_KEY environment variable or pass apiKey option.");
  }

  const url = new URL(BASE_URL);
  url.searchParams.set("action", action);
  Object.entries(opts.params || {}).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url, {
    method: opts.body ? "POST" : "GET",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });

  const data = await res.json();

  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

export async function getDomains(opts = {}) {
  const data = await api("domains", opts);
  return data.domains;
}

export async function createInbox(opts = {}) {
  const body = {};
  if (opts.desiredLocal) body.desired_local = opts.desiredLocal;
  if (opts.domain) body.domain = opts.domain;
  if (opts.ownerToken) body.owner_token = opts.ownerToken;

  const data = await api("create", { ...opts, body });
  return {
    address: data.address,
    ownerToken: data.owner_token,
    domain: data.domain,
    expiresAt: data.expires_at,
  };
}

export async function getInboxes(ownerToken, opts = {}) {
  const data = await api("inboxes", {
    ...opts,
    params: { owner_token: ownerToken },
  });
  return data.inboxes;
}

export async function getMessages(address, ownerToken, opts = {}) {
  const data = await api("messages", {
    ...opts,
    params: { address, owner_token: ownerToken },
  });
  return data.messages;
}

export async function getMessage(id, ownerToken, opts = {}) {
  const data = await api("message", {
    ...opts,
    params: { id, owner_token: ownerToken },
  });
  return data.message;
}

export async function deleteInbox(address, ownerToken, opts = {}) {
  await api("delete", {
    ...opts,
    body: { address, owner_token: ownerToken },
  });
  return { ok: true };
}

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
        if (/^\d{3,8}$/.test(candidate) || /^[A-Z0-9]{4,8}$/i.test(candidate)) {
          if (!NON_OTP_KEYWORDS.test(candidate) && !/^20\d{2}$/.test(candidate)) {
            const digits = candidate.replace(/\D/g, "");
            if (!/^(\d)\1+$/.test(digits)) {
              candidates.push({ val: candidate, score: 10 - (j - i) });
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

export async function pollForOTP(address, ownerToken, opts = {}) {
  const timeout = opts.timeout || 120000;
  const pollInterval = opts.pollInterval || 5000;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const messages = await getMessages(address, ownerToken, opts);

    for (const msg of messages) {
      const text = msg.html_body || msg.text_body || "";
      const otp = extractOTP(text);
      if (otp) {
        return {
          otp,
          from: msg.from_address,
          subject: msg.subject,
          receivedAt: msg.received_at,
          messageId: msg.id,
        };
      }
    }

    await new Promise((r) => setTimeout(r, pollInterval));
  }

  throw new Error(`OTP timeout after ${timeout}ms for ${address}`);
}

export async function waitForEmail(address, ownerToken, opts = {}) {
  const timeout = opts.timeout || 120000;
  const pollInterval = opts.pollInterval || 5000;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const messages = await getMessages(address, ownerToken, opts);
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
      };
    }

    await new Promise((r) => setTimeout(r, pollInterval));
  }

  throw new Error(`Email timeout after ${timeout}ms for ${address}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2];

  if (command === "domains") {
    const domains = await getDomains();
    console.log("Available domains:", domains);
  } else if (command === "create") {
    const inbox = await createInbox({
      desiredLocal: process.argv[3],
      domain: process.argv[4],
    });
    console.log("Created inbox:", inbox);
  } else if (command === "inboxes") {
    const ownerToken = process.argv[3];
    if (!ownerToken) {
      console.error("Usage: node temp-mail-client.mjs inboxes <owner_token>");
      process.exit(1);
    }
    const inboxes = await getInboxes(ownerToken);
    console.log("Inboxes:", inboxes);
  } else if (command === "messages") {
    const address = process.argv[3];
    const ownerToken = process.argv[4];
    if (!address || !ownerToken) {
      console.error("Usage: node temp-mail-client.mjs messages <address> <owner_token>");
      process.exit(1);
    }
    const messages = await getMessages(address, ownerToken);
    console.log("Messages:", messages);
  } else if (command === "delete") {
    const address = process.argv[3];
    const ownerToken = process.argv[4];
    if (!address || !ownerToken) {
      console.error("Usage: node temp-mail-client.mjs delete <address> <owner_token>");
      process.exit(1);
    }
    await deleteInbox(address, ownerToken);
    console.log("Deleted:", address);
  } else if (command === "test") {
    console.log("Testing Temp Mail API...");
    console.log("Creating inbox...");
    const inbox = await createInbox();
    console.log("✓ Inbox created:", inbox.address);
    console.log("\nOwner token:", inbox.ownerToken);
    console.log("\nWaiting for email (Ctrl+C to stop)...");
    console.log("Send an email to", inbox.address, "to test message fetching.");

    try {
      const email = await waitForEmail(inbox.address, inbox.ownerToken, { timeout: 300000 });
      console.log("\n✓ Email received:");
      console.log("  From:", email.from);
      console.log("  Subject:", email.subject);
      if (email.otp) console.log("  OTP:", email.otp);
    } catch (e) {
      console.log("\nTimeout waiting for email:", e.message);
    }
  } else {
    console.log(`
Temp Mail API Client

Commands:
  domains                          List available domains
  create [prefix] [domain]         Create new inbox
  inboxes <owner_token>            List inboxes for owner
  messages <address> <owner_token> Fetch messages
  delete <address> <owner_token>   Delete inbox
  test                             Create inbox and wait for email

Environment:
  TM_API_KEY    API key (tmk_... format)

Examples:
  TM_API_KEY=tmk_xxx node scripts/temp-mail-client.mjs domains
  TM_API_KEY=tmk_xxx node scripts/temp-mail-client.mjs create myprefix
  TM_API_KEY=tmk_xxx node scripts/temp-mail-client.mjs test
`);
  }
}
