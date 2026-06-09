/**
 * state.js — Application state management and localStorage helpers.
 *
 * Centralizes all mutable state and persistence logic.
 * The variable previously named `history` is now `inboxHistory`
 * to avoid shadowing `window.history`.
 */

import {
  LS_OWNER_TOKEN,
  LS_HISTORY,
  LS_DOMAIN,
  LS_DARK_MODE,
  LS_TOKEN_POOL,
  LS_SEEN_MESSAGES,
  MAX_INBOX_HISTORY,
  TOKEN_POOL_SIZE,
} from './config.js';

// ── Mutable state ──

export let domains = [];
export let currentInbox = null;
export let messages = [];
export let inboxHistory = [];
export let selectedDomain = null;
export let ownerToken = '';
export let tokenPool = [];
export let seenMessages = {};
export let messageCounts = new Map();

// ── Setters for external modules (ES module exports are read-only imports) ──

export function setMessageCounts(counts) {
  messageCounts = counts;
}

export function setCurrentInbox(inbox) {
  currentInbox = inbox;
}

export function setMessages(msgs) {
  messages = msgs;
}

export function setDomains(doms) {
  domains = doms;
}

// ── Owner token (identity for rate-limit bypass) ──

function generateToken() {
  return crypto.randomUUID() + crypto.randomUUID().replace(/-/g, '');
}

export function initOwnerToken() {
  ownerToken = localStorage.getItem(LS_OWNER_TOKEN);
  if (!ownerToken) {
    ownerToken = generateToken();
    localStorage.setItem(LS_OWNER_TOKEN, ownerToken);
  }
}

export function rotateOwnerToken() {
  ownerToken = generateToken();
  localStorage.setItem(LS_OWNER_TOKEN, ownerToken);
}

export function resetOwnerToken() {
  ownerToken = generateToken();
  localStorage.setItem(LS_OWNER_TOKEN, ownerToken);
  // Also rotate all pool tokens so bulk uses fresh identities
  tokenPool = tokenPool.map(() => generateToken());
  saveTokenPool();
}

// ── Token pool (50 identities for aggressive rate-limit bypass) ──

export function initTokenPool() {
  try {
    const p = JSON.parse(localStorage.getItem(LS_TOKEN_POOL));
    if (Array.isArray(p) && p.length > 0) {
      tokenPool = p;
    }
  } catch (e) {
    // Corrupted pool — rebuild
  }
  while (tokenPool.length < TOKEN_POOL_SIZE) {
    tokenPool.push(generateToken());
  }
  saveTokenPool();
}

export function saveTokenPool() {
  localStorage.setItem(LS_TOKEN_POOL, JSON.stringify(tokenPool));
}

export function rotatePoolToken(index) {
  tokenPool[index] = generateToken();
}

// ── Inbox history ──

export function initHistory() {
  try {
    inboxHistory = JSON.parse(localStorage.getItem(LS_HISTORY) || '[]');
  } catch (e) {
    inboxHistory = [];
  }
}

export function addHistoryEntry(inbox) {
  inboxHistory = [
    inbox,
    ...inboxHistory.filter((h) => h.address !== inbox.address),
  ].slice(0, MAX_INBOX_HISTORY);
  saveHistory();
}

export function clearHistory() {
  inboxHistory = [];
  localStorage.removeItem(LS_HISTORY);
}

export function saveHistory() {
  localStorage.setItem(LS_HISTORY, JSON.stringify(inboxHistory));
}

// ── Seen messages tracking (for unread badges) ──

export function initSeenMessages() {
  try {
    seenMessages = JSON.parse(localStorage.getItem(LS_SEEN_MESSAGES) || '{}');
  } catch (e) {
    seenMessages = {};
  }
}

export function markMessageSeen(inboxAddress, messageId) {
  if (!seenMessages[inboxAddress]) {
    seenMessages[inboxAddress] = [];
  }
  if (!seenMessages[inboxAddress].includes(messageId)) {
    seenMessages[inboxAddress].push(messageId);
  }
  // Keep only last 500 entries per inbox to avoid bloat
  if (seenMessages[inboxAddress].length > 500) {
    seenMessages[inboxAddress] = seenMessages[inboxAddress].slice(-500);
  }
  localStorage.setItem(LS_SEEN_MESSAGES, JSON.stringify(seenMessages));
}

export function getUnreadCount(inboxAddress) {
  const seen = seenMessages[inboxAddress] || [];
  // We can only count if we have the messages loaded; this returns
  // the stored seen list length for badge display.
  return seen.length;
}

export function isMessageSeen(inboxAddress, messageId) {
  const seen = seenMessages[inboxAddress] || [];
  return seen.includes(messageId);
}

// ── Selected domain ──

export function initSelectedDomain() {
  selectedDomain = localStorage.getItem(LS_DOMAIN) || '__random__';
}

export function setSelectedDomain(domain) {
  selectedDomain = domain;
  localStorage.setItem(LS_DOMAIN, domain);
}

// ── Dark mode ──

export function isDarkMode() {
  return document.documentElement.classList.contains('dark');
}

export function initDarkMode() {
  if (localStorage.getItem(LS_DARK_MODE) === '1') {
    document.documentElement.classList.add('dark');
  }
}

export function toggleDarkMode() {
  document.documentElement.classList.toggle('dark');
  const dark = isDarkMode();
  localStorage.setItem(LS_DARK_MODE, dark ? '1' : '0');
  return dark;
}
