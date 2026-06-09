/**
 * app.js — Application entry point, wiring, polling, and realtime subscriptions.
 */

import {
  POLL_INTERVAL_MS,
  MAX_BULK_COUNT,
  ICONS,
  genHumanPrefix,
} from './config.js';

import {
  domains as stateDomains,
  currentInbox,
  inboxHistory,
  messages as stateMessages,
  initOwnerToken,
  initTokenPool,
  initHistory,
  initSelectedDomain,
  initDarkMode,
  initSeenMessages,
  resetOwnerToken,
  addHistoryEntry,
  clearHistory,
  saveHistory,
  markMessageSeen,
  setCurrentInbox,
  setMessages,
  setDomains,
  setMessageCounts,
} from './state.js';

import {
  sb,
  fetchDomains,
  getEffDomain,
  createInbox,
  bulkCreateInboxes,
  fetchMessages as apiFetchMessages,
  fetchMessagesForAddresses,
  fetchMessageCounts,
  lookupSharedInbox,
} from './api.js';

import {
  $,
  toast,
  toastSafe,
  copyText,
  renderInbox,
  renderDomains,
  renderMessages,
  renderInboxHistory,
  showLoadingSkeleton,
  hideLoadingSkeleton,
  showMessageModal,
  initThemeToggle,
  initKeyboardShortcuts,
  openModal,
  closeModal,
  closeAllModals,
  setHistoryFilter,
  renderBulkDomains,
  startExpiryTicker,
  formatExpiry,
  escapeHtml,
} from './ui.js';

// ── Inbox selection ──

let channel = null;
let pollInterval = null;
let fetchInFlight = false;
async function prefetchHistoryCounts() {
  if (inboxHistory.length === 0) return;
  const addresses = inboxHistory.map((h) => h.address);
  const counts = await fetchMessageCounts(addresses);
  setMessageCounts(counts);
  renderInboxHistory();
}

function selectInbox(inbox) {
  setCurrentInbox(inbox);
  renderInbox();
  renderInboxHistory();

  if (inbox) {
    setMessages([]);
    renderMessages();
    fetchAndRenderMessages();
    subscribe();
    startPoll();
  } else {
    setMessages([]);
    renderMessages();
    stopPoll();
    if (channel) {
      sb.removeChannel(channel);
      channel = null;
    }
  }
}

// ── Message fetching ──

async function fetchAndRenderMessages() {
  if (!currentInbox || fetchInFlight) return;
  fetchInFlight = true;
  try {
    const msgs = await apiFetchMessages(currentInbox.address);
    const prevCount = stateMessages.length;
    setMessages(msgs);
    renderMessages();

    if (msgs.length > prevCount && prevCount > 0) {
      const nc = msgs.length - prevCount;
      toast(
        ICONS.mail + ' ' + nc + ' new email' + (nc > 1 ? 's' : '') + '!'
      );
    }
  } finally {
    fetchInFlight = false;
  }
}

// ── Realtime subscription ──

function subscribe() {
  if (channel) sb.removeChannel(channel);
  if (!currentInbox) return;

  const addr = currentInbox.address;
  channel = sb
    .channel('tm-' + addr)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'temp_messages',
        filter: 'inbox_address=eq.' + addr,
      },
      (payload) => {
        const existing = stateMessages;
        if (existing.some((m) => m.id === payload.new.id)) return;
        setMessages([payload.new, ...existing]);
        renderMessages();
        toast(ICONS.mail + ' New email!');
      }
    )
    .subscribe();
}

// ── Polling ──

function startPoll() {
  stopPoll();
  if (currentInbox) {
    pollInterval = setInterval(fetchAndRenderMessages, POLL_INTERVAL_MS);
  }
}

function stopPoll() {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }
}

// ── Inbox creation handlers ──

async function handleGenInbox(prefix) {
  try {
    const domain = getEffDomain();
    const inbox = await createInbox(prefix, domain);
    addHistoryEntry(inbox);
    selectInbox(inbox);
    toast('Inbox created!');
  } catch (e) {
    console.error('Failed to create inbox:', e);
    toastSafe('Failed to create inbox');
  }
}

async function handleCustomInbox(prefix, domain) {
  const d = domain || getEffDomain();
  const local = (prefix || '').toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (local && local.length < 3) {
    toastSafe('Prefix min 3 chars');
    return;
  }
  try {
    const inbox = await createInbox(local || undefined, d);
    addHistoryEntry(inbox);
    selectInbox(inbox);
    closeModal('newInboxModal');
    toast('Inbox created!');
  } catch (e) {
    console.error('Failed to create custom inbox:', e);
    toastSafe('Failed to create inbox');
  }
}

async function handleBulkCreate(count, domain) {
  const $bulkBtn = $('bulkBtn');
  const $bulkProgress = $('bulkProgress');
  const $bulkBar = $('bulkBar');
  const orig = $bulkBtn.innerHTML;

  $bulkBtn.innerHTML = '<span class="spinner"></span>';
  $bulkBtn.disabled = true;
  $bulkProgress.style.display = 'block';
  $bulkBar.style.width = '0%';

  let rafId = null;
  function updateProgress(done, total) {
    if (!rafId) {
      rafId = requestAnimationFrame(() => {
        rafId = null;
        $bulkBar.style.width = Math.min(100, (done / total) * 100) + '%';
      });
    }
  }

  try {
    const results = await bulkCreateInboxes(count, updateProgress, domain);
    for (const inbox of results) {
      addHistoryEntry(inbox);
    }
    if (results.length > 0) {
      selectInbox(results[0]);
    }
    toastSafe(results.length + '/' + count + ' inboxes created');
  } catch (e) {
    console.error('Bulk creation failed:', e);
    toastSafe('Bulk creation failed');
  } finally {
    $bulkBtn.innerHTML = orig;
    $bulkBtn.disabled = false;
    $bulkProgress.style.display = 'none';
  }
}

function handleReset() {
  resetOwnerToken();
  const prefix = genHumanPrefix();
  handleGenInbox(prefix);
  toastSafe('\u267B Identity rotated');
}

// ── Wire event listeners ──

function wireEvents() {
  $('copyBtn').addEventListener('click', () => {
    if (currentInbox) copyText(currentInbox.address);
  });

  $('shareBtn').addEventListener('click', () => {
    if (currentInbox) {
      copyText(
        'https://mocasus.my.id/temp-mail?inbox=' + encodeURIComponent(currentInbox.address)
      );
    }
  });

  $('resetBtn').addEventListener('click', handleReset);

  $('refreshBtn').addEventListener('click', fetchAndRenderMessages);

  window.addEventListener('tm:refresh', fetchAndRenderMessages);

  $('dumpBtn').addEventListener('click', () => {
    if (inboxHistory.length === 0) return;
    clearHistory();
    selectInbox(null);
    toast(ICONS.trash + ' All inboxes cleared');
  });

  $('newBtn').addEventListener('click', () => {
    $('prefixInput').value = '';
    renderDomains();
    openModal('newInboxModal');
  });

  $('newModalClose').addEventListener('click', () =>
    closeModal('newInboxModal')
  );
  $('newModalCancel').addEventListener('click', () =>
    closeModal('newInboxModal')
  );
  $('newInboxModal').addEventListener('click', (e) => {
    if (e.target === $('newInboxModal')) closeModal('newInboxModal');
  });
  $('newModalCreate').addEventListener('click', () => {
    const prefix = $('prefixInput').value.trim();
    const chip = document.querySelector('.domain-chip.active');
    handleCustomInbox(
      prefix || undefined,
      chip?.dataset.domain === '__random__' ? null : chip?.dataset.domain
    );
  });

  $('bulkBtn').addEventListener('click', () => {
    $('bulkCountInput').value = '15';
    renderBulkDomains();
    openModal('bulkModal');
    setTimeout(() => $('bulkCountInput').focus(), 100);
  });
  $('bulkModalClose').addEventListener('click', () =>
    closeModal('bulkModal')
  );
  $('bulkModalCancel').addEventListener('click', () =>
    closeModal('bulkModal')
  );
  $('bulkModal').addEventListener('click', (e) => {
    if (e.target === $('bulkModal')) closeModal('bulkModal');
  });
  $('bulkModalGo').addEventListener('click', () => {
    const c = parseInt($('bulkCountInput').value, 10);
    const bulkDomainEl = document.getElementById('bulkDomainSelector');
    const selectedBulkDomain = bulkDomainEl?.dataset?.domain;
    const bulkDomain = selectedBulkDomain && selectedBulkDomain !== '__random__' ? selectedBulkDomain : null;
    if (c > 0) {
      closeModal('bulkModal');
      handleBulkCreate(Math.min(c, MAX_BULK_COUNT), bulkDomain);
    }
  });
  $('bulkCountInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('bulkModalGo').click();
  });

  $('msgModalClose').addEventListener('click', () =>
    closeModal('msgModal')
  );
  $('msgModal').addEventListener('click', (e) => {
    if (e.target === $('msgModal')) closeModal('msgModal');
  });

  $('copyOtpBtn').addEventListener('click', () => {
    const code = $('otpCode').textContent;
    if (code) copyText(code);
  });

  $('inboxHistoryList').addEventListener('click', (e) => {
    const chip = e.target.closest('.hist-chip');
    if (!chip) return;
    const idx = parseInt(chip.dataset.idx);
    if (inboxHistory[idx]?.address !== currentInbox?.address) {
      selectInbox(inboxHistory[idx]);
    }
    copyText(currentInbox.address);
  });

  $('msgList').addEventListener('click', (e) => {
    const otpBadge = e.target.closest('.badge[data-otp]');
    if (otpBadge) {
      copyText(otpBadge.dataset.otp);
      toast('OTP ' + escapeHtml(otpBadge.dataset.otp) + ' copied!');
      return;
    }
    const linkBadge = e.target.closest('.badge-link[data-link]');
    if (linkBadge) {
      copyText(linkBadge.dataset.link);
      toastSafe('Verification link copied!');
      return;
    }
    const item = e.target.closest('.msg-item');
    if (item) {
      showMessageModal(stateMessages[parseInt(item.dataset.idx)]);
    }
  });

  const $historySearch = $('historySearch');
  if ($historySearch) {
    $historySearch.addEventListener('input', (e) => {
      setHistoryFilter(e.target.value);
    });
  }
}

// ── Initialization ──

async function init() {
  initDarkMode();
  initOwnerToken();
  initTokenPool();
  initHistory();
  initSelectedDomain();
  initSeenMessages();

  initThemeToggle();
  initKeyboardShortcuts();
  wireEvents();

  showLoadingSkeleton();

  // Parallel: fetch domains + pre-fetch messages for last inbox
  const lastAddr = inboxHistory[0]?.address;
  const parallelTasks = [
    fetchDomains().catch((e) => {
      console.error('Failed to load domains:', e);
      toastSafe('Failed to load domains');
      return [];
    }),
    lastAddr ? apiFetchMessages(lastAddr).catch(() => []) : Promise.resolve([]),
  ];

  const [doms, preloadedMsgs] = await Promise.all(parallelTasks);
  setDomains(doms);
  renderDomains();

  // Apply preloaded messages if we have a last inbox
  if (lastAddr && preloadedMsgs.length > 0) {
    setMessages(preloadedMsgs);
  }

  hideLoadingSkeleton();

  if (inboxHistory.length > 0) {
    selectInbox(inboxHistory[0]);
  } else {
    await handleGenInbox(genHumanPrefix());
  }

  // Background: prefetch message counts for all history inboxes
  prefetchHistoryCounts();

  startExpiryTicker(renderInbox);

  const params = new URLSearchParams(window.location.search);
  const shared = params.get('inbox')?.toLowerCase().trim();
  if (
    shared &&
    /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(shared) &&
    stateDomains.some((d) => d.domain === shared.split('@')[1])
  ) {
    try {
      const data = await lookupSharedInbox(shared);
      if (data) {
        addHistoryEntry(data);
        selectInbox(data);
        const u = new URL(window.location);
        u.searchParams.delete('inbox');
        window.history.replaceState({}, '', u.toString());
      }
    } catch (e) {
      console.error('Failed to open shared inbox:', e);
      toastSafe('Failed to open shared inbox');
    }
  }
}

document.addEventListener('DOMContentLoaded', init);
