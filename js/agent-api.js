/**
 * agent-api.js — Programmatic API for AI agents and browser automation.
 *
 * Exposes window.TempMailAPI so any script, console session, Playwright/Puppeteer
 * automation, or AI agent can use TempMail without clicking UI elements.
 *
 * Usage (browser console or automation script):
 *   const api = window.TempMailAPI;
 *   const email = await api.generateEmail();
 *   const otp = await api.waitForOTP(email.address);
 *
 * URL-based API mode (add ?api=... to URL):
 *   ?api=generate              → JSON {address, expires_at}
 *   ?api=messages&address=x    → JSON messages array
 *   ?api=otp&address=x         → JSON {otp, link, from, subject}
 *   ?api=inboxes               → JSON all inbox history
 *   ?api=wait&address=x&t=60   → JSON waits up to t seconds for OTP
 */

import {
  sb,
  fetchDomains,
  getEffDomain,
  createInbox,
  fetchMessages as apiFetchMessages,
} from './api.js';

import {
  currentInbox,
  inboxHistory,
  messages as stateMessages,
  domains as stateDomains,
  addHistoryEntry,
  setCurrentInbox,
  setMessages,
} from './state.js';

import { genHumanPrefix } from './config.js';
import { extractOTP, extractVerifyLink, extractVerification } from './otp.js';

const DEFAULT_OTP_TIMEOUT_MS = 60_000;
const POLL_MS = 50;

let _subscribedAddresses = new Set();
let _realtimeChannels = new Map();

function subscribeAddress(address) {
  if (_subscribedAddresses.has(address)) return;
  _subscribedAddresses.add(address);

  const ch = sb
    .channel('agent-' + address)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'temp_messages',
        filter: 'inbox_address=eq.' + address,
      },
      (payload) => {
        const evts = _messageListeners.get(address);
        if (evts) evts.forEach((fn) => fn(payload.new));
      }
    )
    .subscribe();

  _realtimeChannels.set(address, ch);
}

let _messageListeners = new Map();

function onMessage(address, fn) {
  if (!_messageListeners.has(address)) _messageListeners.set(address, []);
  _messageListeners.get(address).push(fn);
  subscribeAddress(address);
  return () => {
    const arr = _messageListeners.get(address);
    if (arr) {
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    }
  };
}

// ── Public API ──

async function generateEmail(prefix, domain) {
  const p = prefix || genHumanPrefix();
  const d = domain || getEffDomain();
  const inbox = await createInbox(p, d);
  addHistoryEntry(inbox);
  setCurrentInbox(inbox);
  subscribeAddress(inbox.address);
  return { address: inbox.address, expires_at: inbox.expires_at };
}

async function getMessages(address) {
  const addr = address || currentInbox?.address;
  if (!addr) return [];
  const msgs = await apiFetchMessages(addr);
  return msgs.map((m) => ({
    id: m.id,
    from: m.sender_address || m.from_address,
    subject: m.subject,
    received_at: m.received_at,
    body_text: m.text_body,
    body_html: m.html_body,
    otp: extractVerification(m.html_body || m.text_body || '').otp,
    verify_link: extractVerification(m.html_body || m.text_body || '').link,
  }));
}

async function waitForOTP(address, timeoutMs) {
  const addr = address || currentInbox?.address;
  if (!addr) throw new Error('No address provided and no current inbox selected');

  const timeout = timeoutMs || DEFAULT_OTP_TIMEOUT_MS;
  const start = Date.now();

  const existing = await apiFetchMessages(addr);
  for (const m of existing) {
    const v = extractVerification(m.html_body || m.text_body || '');
    if (v.otp || v.link) {
      return {
        otp: v.otp,
        link: v.link,
        from: m.sender_address || m.from_address,
        subject: m.subject,
        received_at: m.received_at,
        message_id: m.id,
      };
    }
  }

  subscribeAddress(addr);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`OTP timeout after ${timeout}ms for ${addr}`));
    }, timeout);

    const unsub = onMessage(addr, (msg) => {
      const v = extractVerification(msg.html_body || msg.text_body || '');
      if (v.otp || v.link) {
        clearTimeout(timer);
        unsub();
        resolve({
          otp: v.otp,
          link: v.link,
          from: msg.sender_address || msg.from_address,
          subject: msg.subject,
          received_at: msg.received_at,
          message_id: msg.id,
        });
      }
    });
  });
}

async function waitForEmail(address, timeoutMs) {
  const addr = address || currentInbox?.address;
  if (!addr) throw new Error('No address provided and no current inbox selected');

  const timeout = timeoutMs || DEFAULT_OTP_TIMEOUT_MS;
  subscribeAddress(addr);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`Email timeout after ${timeout}ms for ${addr}`));
    }, timeout);

    const unsub = onMessage(addr, (msg) => {
      clearTimeout(timer);
      unsub();
      const v = extractVerification(msg.html_body || msg.text_body || '');
      resolve({
        id: msg.id,
        from: msg.sender_address || msg.from_address,
        subject: msg.subject,
        received_at: msg.received_at,
        otp: v.otp,
        verify_link: v.link,
        body_text: msg.text_body,
        body_html: msg.html_body,
      });
    });
  });
}

async function quickSession(prefix, domain) {
  const inbox = await generateEmail(prefix, domain);
  return {
    address: inbox.address,
    expires_at: inbox.expires_at,
    waitForOTP: (timeoutMs) => waitForOTP(inbox.address, timeoutMs),
    waitForEmail: (timeoutMs) => waitForEmail(inbox.address, timeoutMs),
    getMessages: () => getMessages(inbox.address),
  };
}

function getLatestOTP(address) {
  const addr = address || currentInbox?.address;
  if (!addr) return null;
  const msgs = stateMessages.filter((m) => m.inbox_address === addr);
  for (const m of msgs) {
    const v = extractVerification(m.html_body || m.text_body || '');
    if (v.otp || v.link) {
      return {
        otp: v.otp,
        link: v.link,
        from: m.sender_address || m.from_address,
        subject: m.subject,
        message_id: m.id,
      };
    }
  }
  return null;
}

function getAllInboxes() {
  return inboxHistory.map((h) => ({
    address: h.address,
    expires_at: h.expires_at,
  }));
}

function getCurrentEmail() {
  return currentInbox
    ? { address: currentInbox.address, expires_at: currentInbox.expires_at }
    : null;
}

function getDomains() {
  return stateDomains.map((d) => ({ domain: d.domain, label: d.label }));
}

async function copyEmail() {
  if (!currentInbox) throw new Error('No current inbox');
  try {
    await navigator.clipboard.writeText(currentInbox.address);
  } catch {
    // fallback for non-HTTPS contexts
    const ta = document.createElement('textarea');
    ta.value = currentInbox.address;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
  return currentInbox.address;
}

// ── URL-based API mode ──

async function handleUrlApi() {
  const params = new URLSearchParams(window.location.search);
  const apiAction = params.get('api');
  if (!apiAction) return false;

  const jsonResponse = (data, status = 200) => {
    document.body.innerHTML = '';
    document.title = 'TempMail API';
    const pre = document.createElement('pre');
    pre.style.cssText = 'font-family:monospace;padding:1rem;white-space:pre-wrap;';
    pre.textContent = JSON.stringify(data, null, 2);
    document.body.appendChild(pre);
    return true;
  };

  try {
    switch (apiAction) {
      case 'generate': {
        const prefix = params.get('prefix') || undefined;
        const domain = params.get('domain') || undefined;
        const result = await generateEmail(prefix, domain);
        jsonResponse(result);
        return true;
      }

      case 'messages': {
        const address = params.get('address');
        const msgs = await getMessages(address);
        jsonResponse(msgs);
        return true;
      }

      case 'otp': {
        const address = params.get('address');
        const otp = getLatestOTP(address);
        if (otp) {
          jsonResponse(otp);
          return true;
        }
        // If no OTP in loaded messages, try fetching
        const addr = address || currentInbox?.address;
        if (addr) {
          const msgs = await getMessages(addr);
          for (const m of msgs) {
            if (m.otp || m.verify_link) {
              jsonResponse({
                otp: m.otp,
                link: m.verify_link,
                from: m.from,
                subject: m.subject,
              });
              return true;
            }
          }
        }
        jsonResponse({ error: 'No OTP found', address: addr });
        return true;
      }

      case 'wait': {
        const address = params.get('address');
        const t = parseInt(params.get('t') || '60', 10) * 1000;
        const result = await waitForOTP(address, t);
        jsonResponse(result);
        return true;
      }

      case 'inboxes': {
        jsonResponse(getAllInboxes());
        return true;
      }

      case 'domains': {
        const doms = await fetchDomains();
        jsonResponse(doms);
        return true;
      }

      case 'email': {
        jsonResponse(getCurrentEmail());
        return true;
      }

      default:
        jsonResponse({
          error: 'Unknown API action',
          available: ['generate', 'messages', 'otp', 'wait', 'inboxes', 'domains', 'email'],
          usage: {
            generate: '?api=generate[&prefix=x][&domain=y]',
            messages: '?api=messages[&address=x]',
            otp: '?api=otp[&address=x]',
            wait: '?api=wait[&address=x][&t=60]',
            inboxes: '?api=inboxes',
            domains: '?api=domains',
            email: '?api=email',
          },
        });
        return true;
    }
  } catch (err) {
    jsonResponse({ error: err.message });
    return true;
  }
}

// ── Expose globally ──

const TempMailAPI = {
  generateEmail,
  getMessages,
  waitForOTP,
  waitForEmail,
  quickSession,
  getLatestOTP,
  getAllInboxes,
  getCurrentEmail,
  getDomains,
  copyEmail,

  // Low-level access
  sb,
  extractOTP,
  extractVerifyLink,
  extractVerification,
  fetchDomains,

  // Help
  help() {
    return {
      description: 'TempMail programmatic API for AI agents and automation',
      functions: {
        'generateEmail(prefix?, domain?)': 'Create new inbox. Returns {address, expires_at}',
        'getMessages(address?)': 'Fetch messages with OTP extracted. Defaults to current inbox',
        'waitForOTP(address?, timeoutMs?)': 'Poll until OTP arrives. Default 60s timeout',
        'waitForEmail(address?, timeoutMs?)': 'Wait for next email. Returns full message + OTP',
        'quickSession(prefix?, domain?)': 'Generate email + helper methods. Returns session object',
        'getLatestOTP(address?)': 'Get OTP from already-loaded messages (synchronous)',
        'getAllInboxes()': 'List all inbox history',
        'getCurrentEmail()': 'Get current inbox address',
        'getDomains()': 'List available email domains',
        'copyEmail()': 'Copy current email to clipboard',
      },
      urlApi: {
        '?api=generate': 'Generate new email → JSON',
        '?api=messages&address=x': 'Get messages → JSON',
        '?api=otp&address=x': 'Get OTP → JSON',
        '?api=wait&address=x&t=60': 'Wait for OTP (seconds) → JSON',
        '?api=inboxes': 'List all inboxes → JSON',
        '?api=domains': 'List domains → JSON',
      },
      quickStart: `
        // One-liner: generate email and wait for OTP
        const session = await TempMailAPI.quickSession();
        console.log('Email:', session.address);
        const otp = await session.waitForOTP();
        console.log('OTP:', otp.otp);
      `,
    };
  },
};

window.TempMailAPI = TempMailAPI;

// Console discovery for AI agents and developers
if (typeof console !== "undefined") {
  console.log("%c🤖 TempMail Agent API available", "font-size:14px;font-weight:bold;color:#00d4aa;");
  console.log("  window.TempMailAPI.generateEmail() → create inbox");
  console.log("  window.TempMailAPI.waitForOTP(addr) → poll for OTP");
  console.log("  window.TempMailAPI.quickSession() → one-liner generate+wait");
  console.log("  window.TempMailAPI.help() → full reference");
  console.log("  URL mode: append ?api=generate|otp|wait|messages");
}

export { TempMailAPI, handleUrlApi };
