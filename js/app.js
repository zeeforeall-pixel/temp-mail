/**
 * app.js — Application entry point, wiring, polling, and realtime subscriptions.
 */

import {
  POLL_INTERVAL_MS,
  MAX_BULK_COUNT,
  MAX_VIP_BULK_COUNT,
  ICONS,
  PREMIUM_DOMAINS,
  genHumanPrefix,
  getMailServerInfo,
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
  bulkCreateVipInboxes,
  fetchMessages as apiFetchMessages,
  fetchMessagesForAddresses,
  fetchMessageCounts,
  lookupSharedInbox,
  createVipInbox,
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
  debouncedRenderInboxHistory,
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
  renderBulkVipDomains,
  startExpiryTicker,
  formatExpiry,
  escapeHtml,
  renderVipCredentials,
} from './ui.js';

import { handleUrlApi } from './agent-api.js';

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
  renderVipCredentials();
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
    pollInterval = setTimeout(async () => {
      await fetchAndRenderMessages();
      startPoll();
    }, POLL_INTERVAL_MS);
  }
}

function stopPoll() {
  if (pollInterval) {
    clearInterval(pollInterval);
    clearTimeout(pollInterval);
    pollInterval = null;
  }
}

// ── Inbox creation handlers ──

async function handleGenInbox(prefix) {
  try {
    const domain = getEffDomain();
    const inbox = await createInbox(prefix, domain);
    addHistoryEntry(inbox);
    debouncedRenderInboxHistory();
    const inboxDomain = inbox.address.split('@')[1] || '';
    if (PREMIUM_DOMAINS.includes(inboxDomain)) {
      toast(ICONS.crown + ' Premium inbox created!');
    } else {
      toast('Inbox created!');
    }
  } catch (e) {
    console.error('Failed to create inbox:', e);
    toastSafe('Failed to create inbox');
  }
}


async function handleVipInbox() {
  const $vipBtn = document.getElementById("vipBtn");
  if ($vipBtn) {
    $vipBtn.disabled = true;
    $vipBtn.innerHTML = "<span class=\"spinner\"></span> Creating VIP...";
  }
  try {
    const prefix = genHumanPrefix();
    const domain = getEffDomain();
    const inbox = await createVipInbox(prefix, domain);
    if (inbox) {
      addHistoryEntry(inbox);
      selectInbox(inbox);
      renderVipCredentials();
      toast("Email+PW created · 疯子 xscope0");
    }
  } catch (e) {
    console.error("Failed to create VIP inbox:", e);
    toastSafe("VIP inbox creation failed");
  } finally {
    if ($vipBtn) {
      $vipBtn.disabled = false;
      $vipBtn.innerHTML = "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"icon\"><path d=\"M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4\"/></svg> Email+PW";
    }
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
    debouncedRenderInboxHistory();
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
    let results;
    if (domain && PREMIUM_DOMAINS.includes(domain)) {
      const vipResult = await bulkCreateVipInboxes(count, {
        domain,
        concurrency: Math.min(count, MAX_VIP_BULK_COUNT),
        onProgress: updateProgress,
      });
      results = vipResult.results;
      const failures = vipResult.failures;
      for (const inbox of results) {
        addHistoryEntry(inbox);
      }
      if (results.length > 0) {
        selectInbox(results[0]);
      }
      toastSafe(results.length + '/' + count + ' VIP inboxes created' + (failures.length ? ' (' + failures.length + ' failed)' : ''));
    } else {
      results = await bulkCreateInboxes(count, updateProgress, domain);
      for (const inbox of results) {
        addHistoryEntry(inbox);
      }
      if (results.length > 0) {
        selectInbox(results[0]);
      }
      toastSafe(results.length + '/' + count + ' inboxes created');
    }
  } catch (e) {
    console.error('Bulk creation failed:', e);
    toastSafe('Bulk creation failed');
  } finally {
    $bulkBtn.innerHTML = orig;
    $bulkBtn.disabled = false;
    $bulkProgress.style.display = 'none';
  }
}

function csvValue(value) {
  const str = String(value ?? '');
  return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
}

function exportVipCsv(inboxes) {
  const headers = [
    'email',
    'password',
    'imap_host',
    'imap_port',
    'imap_encryption',
    'smtp_host',
    'smtp_port',
    'smtp_encryption',
    'smtp_port_alt',
    'smtp_encryption_alt',
    'username',
    'expires_at',
  ];
  const rows = inboxes.map((inbox) => {
    const domain = inbox.address.split('@')[1] || '';
    const server = getMailServerInfo(domain);
    return [
      inbox.address,
      inbox.password_plain,
      server.imap.host,
      server.imap.port,
      server.imap.encryption,
      server.smtp.host,
      server.smtp.port,
      server.smtp.encryption,
      server.smtp.altPort,
      server.smtp.altEncryption,
      inbox.address,
      inbox.expires_at,
    ];
  });
  const csv = [headers, ...rows]
    .map((row) => row.map(csvValue).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'vip-inboxes-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function handleBulkVipCreate(count, domain) {
  const $bulkVipBtn = $('bulkVipBtn');
  const $bulkVipGo = $('bulkVipModalGo');
  const $bulkVipProgress = $('bulkVipProgress');
  const $bulkVipBar = $('bulkVipBar');
  const origBtn = $bulkVipBtn.innerHTML;
  const origGo = $bulkVipGo.innerHTML;

  $bulkVipBtn.innerHTML = '<span class="spinner"></span> VIP';
  $bulkVipGo.innerHTML = '<span class="spinner"></span> Creating...';
  $bulkVipBtn.disabled = true;
  $bulkVipGo.disabled = true;
  $bulkVipProgress.style.display = 'block';
  $bulkVipBar.style.width = '0%';

  function updateProgress(done, total) {
    $bulkVipBar.style.width = Math.min(100, (done / total) * 100) + '%';
  }

  try {
    const { results, failures } = await bulkCreateVipInboxes(count, {
      domain,
      onProgress: updateProgress,
    });
    for (const inbox of results) addHistoryEntry(inbox);
    if (results.length > 0) {
      selectInbox(results[0]);
      exportVipCsv(results);
    }
    closeModal('bulkVipModal');
    toastSafe(results.length + '/' + count + ' VIP inboxes created' + (failures.length ? ' (' + failures.length + ' failed)' : ''));
  } catch (e) {
    console.error('Bulk VIP creation failed:', e);
    toastSafe('Bulk VIP creation failed');
  } finally {
    $bulkVipBtn.innerHTML = origBtn;
    $bulkVipGo.innerHTML = origGo;
    $bulkVipBtn.disabled = false;
    $bulkVipGo.disabled = false;
    $bulkVipProgress.style.display = 'none';
  }
}

const I18N = {
  zh: {
    tagline: '一次性邮箱 · 由 疯子 xscope0 制作',
    inboxTitle: '当前收件箱',
    search: '搜索收件箱…',
  },
  en: {
    tagline: 'Disposable inbox · by 疯子 xscope0',
    inboxTitle: 'Your inbox',
    search: 'Search inboxes…',
  },
  id: {
    tagline: 'Email sementara · oleh 疯子 xscope0',
    inboxTitle: 'Inbox kamu',
    search: 'Cari inbox…',
  },
};

function applyLanguage(lang) {
  const nextLang = I18N[lang] ? lang : 'zh';
  localStorage.setItem('tm_lang', nextLang);
  document.documentElement.lang = nextLang === 'zh' ? 'zh' : nextLang;
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === nextLang);
  });
  const tagline = document.querySelector('[data-i18n="tagline"]');
  if (tagline) tagline.textContent = I18N[nextLang].tagline;
  const inboxTitle = document.querySelector('[data-i18n="inboxTitle"]');
  if (inboxTitle) inboxTitle.textContent = I18N[nextLang].inboxTitle;
  const historySearch = $('historySearch');
  if (historySearch) historySearch.placeholder = I18N[nextLang].search;
}

// ── Wire event listeners ──

function wireEvents() {
  $('apiBtn').addEventListener('click', () => openModal('apiModal'));
  $('apiModalClose').addEventListener('click', () => closeModal('apiModal'));
  $('apiModal').addEventListener('click', (e) => {
    if (e.target === $('apiModal')) closeModal('apiModal');
  });
  $('copyBtn').addEventListener('click', () => {
    if (currentInbox) copyText(currentInbox.address);
  });

  $('deleteBtn').addEventListener('click', async () => {
    if (!currentInbox) return;
    const addr = currentInbox.address;
    if (!confirm(`Delete ${addr} and all its messages?`)) return;
    try {
      await TempMailAPI.deleteInbox(addr);
      toast('Inbox deleted');
      if (inboxHistory.length > 0) {
        selectInbox(inboxHistory[0]);
      } else {
        await handleGenInbox(genHumanPrefix());
      }
    } catch (e) {
      console.error('Delete failed:', e);
      toastSafe('Failed to delete inbox');
    }
  });


  // VIP inbox creation
  $('vipBtn').addEventListener('click', () => handleVipInbox());
  $('bulkVipBtn').addEventListener('click', () => {
    $('bulkVipCountInput').value = '25';
    renderBulkVipDomains();
    openModal('bulkVipModal');
    setTimeout(() => $('bulkVipCountInput').focus(), 100);
  });
  $('shareBtn').addEventListener('click', () => {
    if (currentInbox) {
      copyText(
        'https://mocasus.my.id/temp-mail?inbox=' + encodeURIComponent(currentInbox.address)
      );
    }
  });

  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', () => applyLanguage(btn.dataset.lang));
  });

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

  $('bulkVipModalClose').addEventListener('click', () =>
    closeModal('bulkVipModal')
  );
  $('bulkVipModalCancel').addEventListener('click', () =>
    closeModal('bulkVipModal')
  );
  $('bulkVipModal').addEventListener('click', (e) => {
    if (e.target === $('bulkVipModal')) closeModal('bulkVipModal');
  });
  $('bulkVipModalGo').addEventListener('click', () => {
    const c = parseInt($('bulkVipCountInput').value, 10);
    const bulkVipDomainEl = document.getElementById('bulkVipDomainSelector');
    const selectedBulkVipDomain = bulkVipDomainEl?.dataset?.domain;
    const bulkVipDomain = selectedBulkVipDomain && selectedBulkVipDomain !== '__random__' ? selectedBulkVipDomain : null;
    if (c > 0) {
      handleBulkVipCreate(Math.min(c, MAX_VIP_BULK_COUNT), bulkVipDomain);
    }
  });
  $('bulkVipCountInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('bulkVipModalGo').click();
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

  if (await handleUrlApi()) return;

  initThemeToggle();
  initKeyboardShortcuts();
  applyLanguage(localStorage.getItem('tm_lang') || 'en');
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

// ── Adaptive polling (pause when tab hidden) ──

let isVisible = true;
let adaptivePollInterval = null;

function getAdaptivePollInterval() {
  if (!isVisible) return 10000;
  return POLL_INTERVAL_MS;
}

function updatePolling() {
  stopPoll();
  if (currentInbox && isVisible) {
    const interval = getAdaptivePollInterval();
    pollInterval = setTimeout(async () => {
      await fetchAndRenderMessages();
      updatePolling();
    }, interval);
  }
}

// Visibility change handler
document.addEventListener('visibilitychange', () => {
  isVisible = !document.hidden;
  if (currentInbox) {
    if (isVisible) {
      fetchAndRenderMessages(); // Immediate fetch when returning
      updatePolling();
    } else {
      stopPoll();
    }
  }
});

// Resize handler for mobile detection
let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    if (currentInbox) updatePolling();
  }, 250);
});

// Override startPoll to use adaptive polling
const originalStartPoll = startPoll;
startPoll = function() {
  stopPoll();
  if (currentInbox && isVisible) {
    const interval = getAdaptivePollInterval();
    pollInterval = setTimeout(async () => {
      await fetchAndRenderMessages();
      startPoll();
    }, interval);
  }
};
