/**
 * ui.js — DOM rendering, event binding, theme toggle, toast, keyboard shortcuts.
 *
 * All DOM manipulation lives here. This module owns the $ helper and
 * all render functions. The app.js module wires events to API calls.
 */

import { ICONS } from './config.js';
import {
  currentInbox,
  messages,
  inboxHistory,
  selectedDomain,
  domains,
  isDarkMode,
  toggleDarkMode,
  setSelectedDomain,
  isMessageSeen,
  messageCounts,
} from './state.js';
import { extractOTP, extractVerifyLink, extractVerification } from './otp.js';
import { sanitizeEmailHtml } from './sanitizer.js';

// ── DOM helper ──

export const $ = (id) => document.getElementById(id);

// ── HTML escaping ──

/**
 * Escape HTML special characters to prevent XSS.
 * Use this for ALL user-supplied content rendered into the DOM.
 */
const _escapeEl = document.createElement('div');
export function escapeHtml(str) {
  _escapeEl.textContent = str || '';
  return _escapeEl.innerHTML;
}

// ── Toast notifications ──

let toastTimer = null;

/**
 * Show a toast notification.
 * INTERNAL USE ONLY — accepts trusted HTML (SVG icons, emoji).
 * Never pass user-supplied content here; use toastSafe() instead.
 *
 * @param {string} msg - Trusted HTML string.
 */
export function toast(msg) {
  const $toast = $('toast');
  $toast.innerHTML = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), 2500);
}

/**
 * Show a toast with user-supplied content (auto-escaped).
 * @param {string} msg - Untrusted text string.
 */
export function toastSafe(msg) {
  toast(escapeHtml(msg));
}

// ── Clipboard ──

/**
 * Copy text to clipboard with fallback for older browsers.
 */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied!');
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toast('Copied!');
  }
}

// ── Time formatting ──

export function fmtTime(iso) {
  const d = new Date(iso);
  const diff = (Date.now() - d) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return d.toLocaleDateString();
}

// ── Expiry countdown ──

let expiryTimer = null;

export function startExpiryTicker(renderInboxFn) {
  stopExpiryTicker();
  expiryTimer = setInterval(renderInboxFn, 30000);
}

export function stopExpiryTicker() {
  if (expiryTimer) {
    clearInterval(expiryTimer);
    expiryTimer = null;
  }
}

/**
 * Format an expiry timestamp as a human-readable countdown.
 * Handles ISO strings, Unix seconds, and Unix milliseconds.
 * Returns null for invalid or unreasonably far-future dates.
 */
export function formatExpiry(expiresAt) {
  if (!expiresAt) return null;

  let expiryMs;
  if (typeof expiresAt === 'number' || /^\d+$/.test(String(expiresAt))) {
    // Unix timestamp — detect seconds vs milliseconds
    const num = Number(expiresAt);
    expiryMs = num < 1e12 ? num * 1000 : num; // < year ~2001 in ms → treat as seconds
  } else {
    expiryMs = new Date(expiresAt).getTime();
  }

  if (isNaN(expiryMs)) return null;

  const remaining = expiryMs - Date.now();
  if (remaining <= 0) return { text: 'Expired', warning: true };

  // Cap: if more than 30 days away, the value is likely wrong or irrelevant
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  if (remaining > THIRTY_DAYS_MS) return null;

  const minutes = Math.floor(remaining / 60000);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const days = Math.floor(hours / 24);

  const warning = remaining < 10 * 60 * 1000; // < 10 minutes

  if (days > 0) {
    return { text: `Expires in ${days}d ${hours % 24}h`, warning };
  }
  if (hours > 0) {
    return { text: `Expires in ${hours}h ${mins}m`, warning };
  }
  return { text: `Expires in ${mins}m`, warning };
}

// ── Render: Inbox ──

export function renderInbox() {
  const $addr = $('addrDisplay');
  const $expiry = $('expiryDisplay');

  if (!currentInbox) {
    $addr.textContent = '—';
    if ($expiry) $expiry.style.display = 'none';
    return;
  }

  $addr.textContent = currentInbox.address;

  // Expiry countdown
  if ($expiry) {
    const exp = formatExpiry(currentInbox.expires_at);
    if (exp) {
      $expiry.textContent = exp.text;
      $expiry.className = 'expiry-badge' + (exp.warning ? ' warning' : '');
      $expiry.style.display = 'inline-block';
    } else {
      $expiry.style.display = 'none';
    }
  }
}

// ── Render: Domains ──

export function renderDomains() {
  const $domainSelector = $('domainSelector');
  $domainSelector.innerHTML = '';

  const allDomains = [
    { domain: '__random__', label: 'Random' },
    ...domains.map((d) => ({
      domain: d.domain,
      label: d.label || `@${d.domain}`,
    })),
  ];

  allDomains.forEach((d) => {
    const el = document.createElement('span');
    el.className =
      'domain-chip' + (d.domain === selectedDomain ? ' active' : '');
    el.dataset.domain = d.domain;

    if (d.domain === '__random__') {
      el.innerHTML = ICONS.dice + ' Random';
    } else {
      el.textContent = d.label;
    }

    el.addEventListener('click', () => {
      document
        .querySelectorAll('.domain-chip')
        .forEach((c) => c.classList.remove('active'));
      el.classList.add('active');
      setSelectedDomain(d.domain);
    });

    $domainSelector.appendChild(el);
  });
}

// ── Render: Messages ──

let _lastMsgIds = '';

export function renderMessages() {
  const $msgList = $('msgList');
  const $msgCount = $('msgCount');

  $msgCount.textContent = messages.length;

  const currentIds = messages.map((m) => m.id).join(',');
  if (currentIds === _lastMsgIds && messages.length > 0) return;
  _lastMsgIds = currentIds;

  if (messages.length === 0) {
    $msgList.innerHTML = `<div class="msg-empty">${ICONS.empty}<div>No messages yet</div><div style="font-size:0.8rem;margin-top:0.3rem;">Send an email to your temp address</div></div>`;
    return;
  }

  $msgList.innerHTML = messages
    .map((m, i) => {
      const combined =
        (m.text_body || '') + '\n' + (m.html_body || '') + '\n' + (m.subject || '');
      let otp = null;
      let link = null;
      try {
        ({ otp, link } = extractVerification(combined));
      } catch (e) {
        console.warn('OTP extraction failed for message', m.id, e);
      }
      const preview = escapeHtml(
        (m.text_body || m.html_body || '')
          .replace(/<[^>]+>/g, '')
          .substring(0, 80)
      );
      const otpBadge = otp ? `<span class="badge" data-otp="${escapeHtml(otp)}">${escapeHtml(otp)}</span>` : '';
      const linkBadge = link ? `<span class="badge badge-link" data-link="${escapeHtml(link)}" title="Verification link detected">🔗 Verify</span>` : '';
      return `<div class="msg-item" data-idx="${i}"><div class="from">${escapeHtml(m.from_address) || 'Unknown'}</div><div class="subj">${otpBadge}${linkBadge}${escapeHtml(m.subject) || '(no subject)'}</div><div class="preview">${preview || '—'}</div><div class="time">${fmtTime(m.received_at)}</div></div>`;
    })
    .join('');
}

// ── Render: Inbox history ──

let historyFilter = '';

export function setHistoryFilter(query) {
  historyFilter = query.toLowerCase();
  renderInboxHistory();
}

export function renderInboxHistory() {
  const el = $('inboxHistoryList');
  if (inboxHistory.length === 0) {
    el.innerHTML =
      '<span style="color:hsl(var(--text2));font-size:0.85rem;">No inboxes yet</span>';
    return;
  }

  const filtered = historyFilter
    ? inboxHistory.filter((h) =>
        h.address.toLowerCase().includes(historyFilter)
      )
    : inboxHistory;

  if (filtered.length === 0) {
    el.innerHTML =
      '<span style="color:hsl(var(--text2));font-size:0.85rem;">No matches</span>';
    return;
  }

  el.innerHTML = filtered
    .map((h) => {
      const realIdx = inboxHistory.findIndex((x) => x.address === h.address);
      const active = currentInbox?.address === h.address;
      const local = h.address.split('@')[0];
      const label =
        local.length > 12
          ? local.slice(0, 10) + '…' + h.address.split('@')[1]
          : h.address;

      const count = messageCounts.get(h.address) || 0;
      const badge = count > 0
        ? `<span class="hist-count">${count}</span>`
        : '';

      return `<span class="hist-chip${active ? ' active' : ''}" data-idx="${realIdx}" title="${escapeHtml(h.address)}">${escapeHtml(label)}${badge}</span>`;
    })
    .join('');
}

// ── Render: Loading skeleton ──

export function showLoadingSkeleton() {
  const $msgList = $('msgList');
  $msgList.innerHTML = `
    <div class="skeleton-block skeleton-line long"></div>
    <div class="skeleton-block skeleton-line"></div>
    <div class="skeleton-block skeleton-line short"></div>
  `;
}

export function hideLoadingSkeleton() {
  // Re-render messages will replace the skeleton
  renderMessages();
}

// ── Modal helpers ──

export function openModal(id) {
  $(id).classList.add('open');
}

export function closeModal(id) {
  $(id).classList.remove('open');
}

export function closeAllModals() {
  document
    .querySelectorAll('.modal-overlay.open')
    .forEach((m) => m.classList.remove('open'));
}

// ── Theme toggle ──

export function initThemeToggle() {
  const $themeToggle = $('themeToggle');
  $themeToggle.innerHTML = isDarkMode() ? ICONS.sun : ICONS.moon;

  $themeToggle.addEventListener('click', () => {
    const dark = toggleDarkMode();
    $themeToggle.innerHTML = dark ? ICONS.sun : ICONS.moon;
  });
}

// ── Keyboard shortcuts ──

export function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Don't trigger when typing in inputs
    const tag = e.target.tagName;
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    if (e.key === 'Escape') {
      closeAllModals();
      return;
    }

    if (isInput) return;

    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      // Dispatch custom event that app.js listens for
      window.dispatchEvent(new CustomEvent('tm:refresh'));
    }

    if (e.key === 'c' || e.key === 'C') {
      e.preventDefault();
      if (currentInbox) {
        copyText(currentInbox.address);
      }
    }
  });
}

// ── Message modal ──

export function showMessageModal(message) {
  const $msgModalSubj = $('msgModalSubj');
  const $msgModalFrom = $('msgModalFrom');
  const $msgModalTo = $('msgModalTo');
  const $msgModalTime = $('msgModalTime');
  const $msgModalContent = $('msgModalContent');
  const $otpRow = $('otpRow');
  const $otpCode = $('otpCode');

  $msgModalSubj.textContent = message.subject || '(no subject)';
  $msgModalFrom.textContent = 'From: ' + (message.from_address || '—');
  $msgModalTo.textContent = 'To: ' + (currentInbox?.address || '—');
  $msgModalTime.textContent =
    'Received: ' +
    (message.received_at
      ? new Date(message.received_at).toLocaleString()
      : '—');

  // OTP + verification link detection
  $otpCode.textContent = '';
  const combined =
    (message.text_body || '') +
    '\n\n---\n\n' +
    (message.html_body || '') +
    '\n\n---\n\n' +
    (message.subject || '');
  let otpCode = null;
  let verifyLink = null;
  try {
    ({ otp: otpCode, link: verifyLink } = extractVerification(combined));
  } catch (e) {
    console.warn('OTP extraction failed in modal', e);
  }

  if (otpCode) {
    $otpCode.textContent = otpCode;
    $otpRow.style.display = 'flex';
  } else {
    $otpRow.style.display = 'none';
  }

  // Verification link row
  const $verifyRow = $('verifyRow');
  const $verifyLink = $('verifyLink');
  const $openVerifyBtn = $('openVerifyBtn');
  if ($verifyRow) {
    if (verifyLink) {
      $verifyLink.textContent = verifyLink.length > 60
        ? verifyLink.slice(0, 57) + '…'
        : verifyLink;
      $verifyLink.href = verifyLink;
      $verifyLink.title = verifyLink;
      $openVerifyBtn.onclick = () => window.open(verifyLink, '_blank', 'noopener');
      $verifyRow.style.display = 'flex';
    } else {
      $verifyRow.style.display = 'none';
    }
  }

  // Render body — sanitize HTML content
  const raw = message.html_body || message.text_body || '';
  if (raw) {
    $msgModalContent.innerHTML = sanitizeEmailHtml(raw);
  } else {
    $msgModalContent.innerHTML =
      '<i style="color:hsl(var(--text2))">(empty)</i>';
  }

  openModal('msgModal');
}
