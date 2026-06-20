/**
 * app.js — Application entry point, wiring, polling, and realtime subscriptions.
 */

import {
  MAX_BULK_COUNT,
  MAX_VIP_BULK_COUNT,
  ICONS,
  PREMIUM_DOMAINS,
  genHumanPrefix,
  getMailServerInfo,
} from './config.js?v=1781753400';

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
} from './state.js?v=1781753400';

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
} from './api.js?v=1781753400';

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
  formatDisplayAddress,
  isUppercaseDisplayEnabled,
  setUppercaseDisplayEnabled,
} from './ui.js?v=1781753400';

import { handleUrlApi } from './agent-api.js?v=1781753400';

// ── Inbox selection ──

let channel = null;
let pollInterval = null;
let _pollGen = 0;
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
  renderInboxHistory();  // Update history list to show active chip

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
  } catch (e) {
    console.warn('Message fetch failed:', e.message);
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
    const gen = ++_pollGen;
    pollInterval = setTimeout(async () => {
      if (gen !== _pollGen) return;
      await fetchAndRenderMessages();
      if (gen !== _pollGen) return;
      startPoll();
    }, getPollMs());
  }
}

function stopPoll() {
  ++_pollGen; // invalidate any in-flight async chains
  if (pollInterval) {
    clearTimeout(pollInterval);
    pollInterval = null;
  }
}

// ── Inbox creation handlers ──

async function handleGenInbox(prefix) {
  try {
    if (!stateDomains || stateDomains.length === 0) {
      toastSafe('No domains available yet');
      return;
    }
    const domain = getEffDomain();
    if (!domain) {
      toastSafe('No domain available');
      return;
    }
    const inbox = await createInbox(prefix, domain);
    addHistoryEntry(inbox);
    selectInbox(inbox);
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
    $vipBtn.innerHTML = "<span class=\"spinner\"></span> Creating Lifetime Pro...";
  }
  try {
    if (!stateDomains || stateDomains.length === 0) {
      toastSafe('No domains available yet');
      if ($vipBtn) {
        $vipBtn.disabled = false;
        $vipBtn.innerHTML = "<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"icon\"><path d=\"M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4\"/></svg> Email+PW";
      }
      return;
    }
    const prefix = genHumanPrefix();
    const domain = getEffDomain();
    if (!domain) {
      toastSafe('No domain available');
      return;
    }
    const inbox = await createVipInbox(prefix, domain);
    if (inbox) {
      addHistoryEntry(inbox);
      selectInbox(inbox);
      renderVipCredentials();
      toast("Email+PW created · xscope0");
    }
  } catch (e) {
      console.error("Failed to create Lifetime Pro inbox:", e);
    toastSafe("inbox creation failed");
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
    const inbox = await createInbox(finalLocal || undefined, d);
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
      toastSafe(results.length + '/' + count + ' inboxes created' + (failures.length ? ' (' + failures.length + ' failed)' : ''));
    } else {
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

  $bulkVipBtn.innerHTML = '<span class="spinner"></span> Lifetime Pro';
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
    });
    for (const inbox of results) addHistoryEntry(inbox);
    if (results.length > 0) {
      selectInbox(results[0]);
      exportVipCsv(results);
    }
    closeModal('bulkVipModal');
    toastSafe(results.length + '/' + count + ' inboxes created' + (failures.length ? ' (' + failures.length + ' failed)' : ''));
  } catch (e) {
    console.error('Bulk creation failed:', e);
    toastSafe('Bulk creation failed');
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
    tagline: '一次性邮箱 · 由 xscope0 制作',
    inboxTitle: '收件箱',
    search: '搜索收件箱…',
    newInbox: '新收件箱',
    bulk: '批量',
    emailPw: '邮箱+密码',
    bulkCsv: '批量 CSV',
    refresh: '刷新',
    github: 'GitHub',
    noInboxes: '暂无收件箱',
    bulkCreateTitle: '批量创建',
    bulkVipTitle: '批量 Lifetime Pro 邮箱+密码',
    advancedTitle: '高级设置',
    uppercaseLabel: '在邮箱前缀中添加一个大写字母',
    uppercaseDesc: '仅装饰效果 — 邮件服务器不区分大小写。',
    refreshLabel: '收件箱刷新间隔',
    refreshWarn: '间隔过低可能触发服务器速率限制。',
    ghDesc: '为你的 GitHub 账号生成用户名、密码和验证邮箱。',
    ghStep1Title: '生成凭据',
    ghStep1Desc: '确认此账号是为你自己使用，且你还没有 GitHub 账号。',
    ghModeLabel: '邮箱验证模式',
    ghModeRandom: '自动随机',
    ghModeCustom: '自定义前缀',
    ghCustomPrefix: '自定义前缀',
    ghGenerateBtn: '生成凭据',
    ghStep2Title: '自动填写 GitHub 表单',
    ghStep2Desc: '设置一次 — 拖到书签栏，随时使用。',
    ghSub1: '点击下方 <strong>"打开 GitHub 注册"</strong>',
    ghSub2: '在 GitHub 标签页，点击书签 <strong>"Auto-Fill Script"</strong> → 字段自动填写（约5秒）',
    ghSub3: '解决验证码（拼图，约10秒）→ 点击 <strong>Create account</strong>',
    ghSub4: '回到这里 — OTP 验证码会自动出现在第3步',
    ghCheck1: '关闭 VPN/代理 — 使用个人网络（4G / 家庭 WiFi）',
    ghCheck2: '不要使用无痕模式 — 使用日常浏览器配置文件',
    ghCheck3: '禁用激进的隐私扩展（uBlock、Brave Shield 最大）',
    ghCheck4: '不要着急 — 慢慢解决验证码',
    ghCheck5: '如果出现"异常活动"：等待24小时 / 切换网络',
    ghDragBookmark: '（拖到书签栏）',
    ghOpenSignup: '打开 GitHub 注册',
    ghStep3Title: 'OTP 验证',
    ghStep3Desc: '在 GitHub 完成第2步后，OTP 验证码会自动显示在这里。',
    ghWaitOtp: '等待 OTP 验证码…',
    ghStep4Title: '设置 2FA（必需！）',
    ghStep4Desc: 'GitHub 要求在注册后30天内设置 2FA。超过期限 = 账号锁定。',
    gh2fa1: '<strong>安装验证器应用</strong> — 推荐：Aegis（Android，开源）或 Raivo（iOS）。避免使用 Google Authenticator（无导出/备份）。',
    gh2fa2: '<strong>打开 GitHub 2FA 设置</strong>',
    gh2fa3: '<strong>扫描二维码 → 输入6位验证码</strong> — 打开验证器应用，点击 +，扫描 GitHub 上的二维码。',
    ghSaveRecovery: '保存恢复码！',
    ghRecoveryDesc: 'GitHub 会给你16个恢复码 — 截图或下载并存储在安全的地方（密码管理器 / 云笔记）。没有这些，如果你丢失手机，账号将永远丢失。',
    ghBonus: '额外提示：2FA 激活后，添加 SSH 密钥和个人访问令牌，这样你就可以无需密码进行 git push。',
    ghSetup2fa: '在 GitHub 上设置 2FA',
  },
  en: {
    tagline: 'Disposable inbox · by xscope0',
    inboxTitle: 'Inboxes',
    search: 'Search inboxes…',
    newInbox: 'New inbox',
    bulk: 'Bulk',
    emailPw: 'Email+PW',
    bulkCsv: 'Bulk CSV',
    refresh: 'Refresh',
    github: 'GitHub',
    noInboxes: 'No inboxes yet',
    bulkCreateTitle: 'Bulk create',
    bulkVipTitle: 'Bulk Lifetime Pro Email + Password',
    advancedTitle: 'Advanced Settings',
    uppercaseLabel: 'Add one random uppercase letter to email prefix',
    uppercaseDesc: 'Cosmetic only — mail servers treat addresses as case-insensitive.',
    refreshLabel: 'Refresh inbox interval',
    refreshWarn: 'Low interval may trigger rate limiting from the server.',
    ghDesc: 'Generate username, password & verification email for your GitHub account.',
    ghStep1Title: 'Generate Credentials',
    ghModeLabel: 'Email verification mode',
    ghModeRandom: 'Auto Random',
    ghModeCustom: 'Custom Prefix',
    ghCustomPrefix: 'Custom prefix',
    ghGenerateBtn: 'Generate Credentials',
    ghStep2Title: 'Auto-Fill GitHub Form',
    ghStep2Desc: 'Setup once — drag to bookmark bar, use anytime.',
    ghSub1: 'Click <strong>"Open GitHub Signup"</strong> below',
    ghSub2: 'On the GitHub tab, click bookmarklet <strong>"Auto-Fill Script"</strong> → fields auto-fill (~5s)',
    ghSub3: 'Solve captcha (puzzle, ~10s) → click <strong>Create account</strong>',
    ghSub4: 'Come back here — OTP appears automatically in Step 3',
    ghCheck1: 'Turn off VPN/proxy — use personal network (4G / home WiFi)',
    ghCheck2: "Don't use Incognito — use your daily browser profile",
    ghCheck3: 'Disable aggressive privacy extensions (uBlock, Brave Shield max)',
    ghCheck4: "Don't rush — solve captcha slowly",
    ghCheck5: 'If "unusual activity" appears: wait 24h / switch network',
    ghDragBookmark: '(drag to bookmark bar)',
    ghOpenSignup: 'Open GitHub Signup',
    ghStep3Title: 'OTP Verification',
    ghStep3Desc: 'After completing Step 2 on GitHub, the OTP code will appear here automatically.',
    ghWaitOtp: 'Waiting for OTP…',
    ghStep4Title: 'Setup 2FA (Required!)',
    ghStep4Desc: 'GitHub requires 2FA within 30 days of signup. Past the deadline = account locked.',
    gh2fa1: '<strong>Install authenticator app</strong> — Recommended: Aegis (Android, open-source) or Raivo (iOS). Avoid Google Authenticator (no export/backup).',
    gh2fa2: '<strong>Open GitHub 2FA settings</strong>',
    gh2fa3: '<strong>Scan QR code → enter 6-digit code</strong> — Open authenticator app, tap +, scan the QR shown on GitHub.',
    ghSaveRecovery: 'Save Recovery Codes!',
    ghRecoveryDesc: 'GitHub gives you 16 recovery codes — screenshot or download & store somewhere safe (password manager / cloud notes). Without these, if you lose your phone the account is gone forever.',
    ghBonus: 'Bonus: after 2FA is active, add SSH key & Personal Access Token so you can git push without password.',
    ghSetup2fa: 'Setup 2FA on GitHub',
  },
  id: {
    tagline: 'Email sementara · oleh xscope0',
    inboxTitle: 'Inboxes',
    search: 'Cari inbox…',
    newInbox: 'Inbox baru',
    bulk: 'Massal',
    emailPw: 'Email+PW',
    bulkCsv: 'Massal CSV',
    refresh: 'Segarkan',
    github: 'GitHub',
    noInboxes: 'Belum ada inbox',
    bulkCreateTitle: 'Buat massal',
    bulkVipTitle: 'Massal Lifetime Pro Email + Password',
    advancedTitle: 'Pengaturan Lanjutan',
    uppercaseLabel: 'Tambahkan satu huruf besar acak ke prefiks email',
    uppercaseDesc: 'Hanya kosmetik — server email tidak membedakan huruf besar/kecil.',
    refreshLabel: 'Interval segarkan inbox',
    refreshWarn: 'Interval terlalu rendah dapat memicu pembatasan rate dari server.',
    ghDesc: 'Buat username, password & email verifikasi untuk akun GitHub kamu.',
    ghStep1Title: 'Buat Kredensial',
    ghStep1Desc: 'Pastikan akun ini untuk dirimu sendiri & kamu belum punya akun GitHub.',
    ghModeLabel: 'Mode verifikasi email',
    ghModeRandom: 'Acak Otomatis',
    ghModeCustom: 'Prefiks Kustom',
    ghCustomPrefix: 'Prefiks kustom',
    ghGenerateBtn: 'Buat Kredensial',
    ghStep2Title: 'Isi Otomatis Form GitHub',
    ghStep2Desc: 'Setup sekali — drag ke bookmark bar, pakai kapan saja.',
    ghSub1: 'Klik <strong>"Open GitHub Signup"</strong> di bawah',
    ghSub2: 'Di tab GitHub, klik bookmarklet <strong>"Auto-Fill Script"</strong> → field terisi otomatis (~5s)',
    ghSub3: 'Selesaikan captcha (puzzle, ~10s) → klik <strong>Create account</strong>',
    ghSub4: 'Kembali ke sini — OTP muncul otomatis di Step 3',
    ghCheck1: 'Matikan VPN/proxy — gunakan jaringan pribadi (4G / WiFi rumah)',
    ghCheck2: 'Jangan pakai Incognito — gunakan profil browser harian',
    ghCheck3: 'Nonaktifkan ekstensi privasi agresif (uBlock, Brave Shield max)',
    ghCheck4: 'Jangan terburu-buru — selesaikan captcha pelan-pelan',
    ghCheck5: 'Jika "unusual activity" muncul: tunggu 24 jam / ganti jaringan',
    ghDragBookmark: '(drag ke bookmark bar)',
    ghOpenSignup: 'Buka GitHub Signup',
    ghStep3Title: 'Verifikasi OTP',
    ghStep3Desc: 'Setelah menyelesaikan Step 2 di GitHub, kode OTP akan muncul di sini secara otomatis.',
    ghWaitOtp: 'Menunggu OTP…',
    ghStep4Title: 'Setup 2FA (Wajib!)',
    ghStep4Desc: 'GitHub mewajibkan 2FA dalam 30 hari setelah pendaftaran. Lewat deadline = akun terkunci.',
    gh2fa1: '<strong>Install aplikasi autentikator</strong> — Rekomendasi: Aegis (Android, open-source) atau Raivo (iOS). Hindari Google Authenticator (tidak ada export/backup).',
    gh2fa2: '<strong>Buka pengaturan 2FA GitHub</strong>',
    gh2fa3: '<strong>Scan QR code → masukkan kode 6 digit</strong> — Buka aplikasi autentikator, tap +, scan QR yang muncul di GitHub.',
    ghSaveRecovery: 'Simpan Recovery Codes!',
    ghRecoveryDesc: 'GitHub memberikan 16 recovery codes — screenshot atau download & simpan di tempat aman (password manager / cloud notes). Tanpa ini, kalau HP hilang, akun hilang selamanya.',
    ghBonus: 'Bonus: setelah 2FA aktif, tambahkan SSH key & Personal Access Token supaya bisa git push tanpa password.',
    ghSetup2fa: 'Setup 2FA di GitHub',
  },
};

function applyLanguage(lang) {
  const nextLang = I18N[lang] ? lang : 'zh';
  localStorage.setItem('tm_lang', nextLang);
  document.documentElement.lang = nextLang === 'zh' ? 'zh' : nextLang;
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === nextLang);
  });
  const dict = I18N[nextLang];
  // Simple text replacements
  const textKeys = ['tagline', 'inboxTitle'];
  textKeys.forEach(key => {
    const el = document.querySelector('[data-i18n="' + key + '"]');
    if (el) el.textContent = dict[key];
  });
  const historySearch = $('historySearch');
  if (historySearch) historySearch.placeholder = dict.search;
  // All other data-i18n elements (GitHub Temp + any future)
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (key === 'tagline' || key === 'inboxTitle' || key === 'search') return;
    if (dict[key] === undefined) return;
    if (dict[key].includes('<')) {
      el.innerHTML = dict[key];
    } else {
      el.textContent = dict[key];
    }
  });
}

// ── Wire event listeners ──

function wireEvents() {
  $('apiBtn').addEventListener('click', () => openModal('apiModal'));
  $('apiModalClose').addEventListener('click', () => closeModal('apiModal'));
  $('apiModal').addEventListener('click', (e) => {
    if (e.target === $('apiModal')) closeModal('apiModal');
  });
  $('copyBtn').addEventListener('click', () => {
    if (currentInbox) copyText(formatDisplayAddress(currentInbox.address));
  });

  $('deleteBtn').addEventListener('click', async () => {
    if (!currentInbox) return;
    const addr = currentInbox.address;
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


  // Lifetime Pro inbox creation
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
        'https://xscope0.vercel.app?inbox=' + encodeURIComponent(currentInbox.address)
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
    if (currentInbox) copyText(formatDisplayAddress(currentInbox.address));
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

  // ── GitHub Helper toggle ──
  const $ghHelperBtn = $('ghHelperBtn');
  const $mainView = $('mainView');
  const $ghView = $('ghView');

  function showGhView() {
    $mainView.style.display = 'none';
    $ghView.style.display = 'block';
    // Change header button to show "Inbox" (go back)
    if ($ghHelperBtn) {
      $ghHelperBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon" style="width:16px;height:16px;"><path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg> Inbox';
      $ghHelperBtn.title = 'Back to Inbox';
      $ghHelperBtn.onclick = showMainView;
    }
  }
  function showMainView() {
    $mainView.style.display = 'block';
    $ghView.style.display = 'none';
    // Clean up OTP poll timer when leaving GitHub view
    if (window._ghOtpPollTimer) { clearInterval(window._ghOtpPollTimer); window._ghOtpPollTimer = null; }
    // Restore header button to "GitHub"
    if ($ghHelperBtn) {
      $ghHelperBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" class="icon" style="width:16px;height:16px;"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg> GitHub';
      $ghHelperBtn.title = 'GitHub Temp';
      $ghHelperBtn.onclick = showGhView;
    }
  }

  if ($ghHelperBtn) $ghHelperBtn.onclick = showGhView;

  // GitHub Helper: mode toggle
  const $ghModeBtns = document.querySelectorAll('.gh-mode-btn');
  const $ghPrefixCustom = $('ghPrefixCustom');
  $ghModeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      $ghModeBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      $ghPrefixCustom.style.display = btn.dataset.mode === 'custom' ? 'block' : 'none';
    });
  });

  // GitHub Helper: generate credential
  const $ghGenerateBtn = $('ghGenerateBtn');
  const $ghCredResult = $('ghCredResult');

  function genPassword(len = 16) {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*';
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    let pw = '';
    for (let i = 0; i < len; i++) pw += chars[arr[i] % chars.length];
    return pw;
  }

  function genUsername(prefix) {
    const adjectives = ['swift','calm','dark','keen','pure','bold','cool','deep','fine','glad','idle','just','live','mild','neat','open','rare','safe','tall','vast','warm'];
    const nouns = ['fox','owl','bear','wolf','deer','hawk','lynx','swan','crow','dove','wren','hare','lark','moth','newt','puma','seal','toad','vole','bat','bee'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const suffix = Math.floor(Math.random() * 9000 + 1000);
    if (prefix) return prefix.toLowerCase().replace(/[^a-z0-9]/g, '') + suffix;
    return adj + noun + suffix;
  }

  if ($ghGenerateBtn) {
    $ghGenerateBtn.addEventListener('click', async () => {
      const activeMode = document.querySelector('.gh-mode-btn.active');
      const mode = activeMode ? activeMode.dataset.mode : 'random';
      let prefix = '';
      if (mode === 'custom') {
        prefix = ($('ghPrefixInput')?.value || '').trim();
      }

      const username = genUsername(prefix);
      const password = genPassword();

      // Generate inbox for verification email
      const domain = getEffDomain();
      try {
        const inbox = await createInbox(genHumanPrefix(), domain);
        if (inbox) {
          addHistoryEntry(inbox);
          selectInbox(inbox);
          const displayEmail = formatDisplayAddress(inbox.address);

          $ghCredResult.style.display = 'block';
          $ghCredResult.innerHTML = `
            <div class="gh-cred-row">
              <span class="gh-cred-label">Username</span>
              <span class="gh-cred-value gh-cred-clickable" data-copy="${escapeHtml(username)}" title="Click to copy">${escapeHtml(username)}</span>
              <button class="gh-cred-copy" data-copy="${escapeHtml(username)}">Copy</button>
            </div>
            <div class="gh-cred-row">
              <span class="gh-cred-label">Password</span>
              <span class="gh-cred-value gh-cred-clickable" data-copy="${escapeHtml(password)}" title="Click to copy">${escapeHtml(password)}</span>
              <button class="gh-cred-copy" data-copy="${escapeHtml(password)}">Copy</button>
            </div>
            <div class="gh-cred-row">
              <span class="gh-cred-label">Email</span>
              <span class="gh-cred-value gh-cred-clickable" data-copy="${escapeHtml(displayEmail)}" title="Click to copy">${escapeHtml(displayEmail)}</span>
              <button class="gh-cred-copy" data-copy="${escapeHtml(displayEmail)}">Copy</button>
            </div>
            `;

          // Wire copy buttons + click-to-copy on values
          $ghCredResult.querySelectorAll('[data-copy]').forEach(el => {
            el.addEventListener('click', () => copyText(el.dataset.copy));
          });

          // ── Update "Open GitHub Signup" link with credential payload ──
          const signupLink = $('ghSignupLink');
          if (signupLink) {
            const credPayload = btoa(JSON.stringify({ email: displayEmail, password, username }));
            signupLink.href = 'https://github.com/join#mocafill=' + encodeURIComponent(credPayload);
          }

          // ── OTP auto-detection: poll inbox for GitHub verification emails ──
          const $ghOtpDisplay = $('ghOtpDisplay');
          if ($ghOtpDisplay) {
            $ghOtpDisplay.innerHTML = '<span data-i18n="ghWaitOtp">Waiting for OTP…</span>';
            $ghOtpDisplay.style.borderColor = 'hsl(var(--border))';
          }

          // Watch for OTP in incoming messages (5-min timeout)
          let otpPollTimer = null;
          const OTP_TIMEOUT_MS = 5 * 60 * 1000;
          const _otpStart = Date.now();
          // Clean up any previous OTP poll when re-generating
          if (window._ghOtpPollTimer) { clearInterval(window._ghOtpPollTimer); window._ghOtpPollTimer = null; }
          function pollForOtp() {
            if (otpPollTimer) clearInterval(otpPollTimer);
            otpPollTimer = setInterval(async () => {
              // Timeout after 5 minutes
              if (Date.now() - _otpStart > OTP_TIMEOUT_MS) {
                clearInterval(otpPollTimer);
                if ($ghOtpDisplay) $ghOtpDisplay.innerHTML = '<span style="color:hsl(var(--danger));">OTP timeout — generate again</span>';
                return;
              }
              if (!currentInbox || currentInbox.address !== inbox.address) {
                clearInterval(otpPollTimer);
                return;
              }
              try {
                const msgs = await apiFetchMessages(inbox.address);
                for (const msg of msgs) {
                  const subject = (msg.subject || '').toLowerCase();
                  const from = (msg.from_address || msg.sender_address || '').toLowerCase();
                  // Check if it's a GitHub verification email
                  if (from.includes('github') || subject.includes('github') || subject.includes('verification') || subject.includes('verify')) {
                    const bodyText = (msg.body_text || '') + ' ' + (msg.body_html || '');
                    const { extractVerification } = await import('./otp.js');
                    const { otp } = extractVerification(bodyText);
                    if (otp && $ghOtpDisplay) {
                      $ghOtpDisplay.innerHTML = '<div style="font-size:1.5rem;font-weight:700;color:hsl(var(--primary));letter-spacing:0.15em;cursor:pointer;" title="Click to copy" id="ghOtpCode">' + escapeHtml(otp) + '</div><div style="font-size:0.75rem;margin-top:0.3rem;color:hsl(var(--text2));">Click to copy</div>';
                      $ghOtpDisplay.style.borderColor = 'hsl(var(--primary))';
                      const otpEl = $('ghOtpCode');
                      if (otpEl) otpEl.addEventListener('click', () => copyText(otp));
                      clearInterval(otpPollTimer);
                      toast('OTP ' + otp + ' received!');
                      return;
                    }
                  }
                }
              } catch (e) {
                console.warn('OTP poll error:', e);
              }
            }, 3000);
            window._ghOtpPollTimer = otpPollTimer;
          }
          pollForOtp();

          // Stay on GitHub Temp view
          toast('GitHub Credentials generated!');
        }
      } catch (e) {
        console.error('GitHub credential generation failed:', e);
        toastSafe('Failed to generate Credentials');
      }
    });
  }

}


// ── Advanced Settings ──
let _pollMs = parseInt(localStorage.getItem('tm_poll_ms') || '5000', 10);
if (!isFinite(_pollMs) || _pollMs < 1) { _pollMs = 5000; localStorage.setItem('tm_poll_ms', '5000'); }

function initAdvancedSettings() {
  const $toggle = $('advancedToggle');
  const $body = $('advancedBody');
  const $arrow = $('advancedArrow');
  const $upper = $('uppercaseToggle');
  const $interval = $('refreshIntervalSelect');
  const $warn = $('refreshWarn');

  if ($toggle && $body) {
    $toggle.addEventListener('click', () => {
      const open = $body.style.display === 'none';
      $body.style.display = open ? 'block' : 'none';
      if ($arrow) $arrow.style.transform = open ? 'rotate(180deg)' : 'rotate(0)';
    });
  }


  if ($interval) {
    $interval.value = String(_pollMs);
    updateRefreshWarn(_pollMs);
    $interval.addEventListener('change', () => {
      _pollMs = parseInt($interval.value, 10);
      localStorage.setItem('tm_poll_ms', String(_pollMs));
      updateRefreshWarn(_pollMs);
      if (currentInbox) {
        stopPoll();
        startPoll();
      }
    });
  }

  if ($upper) {
    $upper.checked = isUppercaseDisplayEnabled();
    $upper.addEventListener('change', () => {
      setUppercaseDisplayEnabled($upper.checked);
      renderInbox();
      renderInboxHistory();
    });
  }
}

function updateRefreshWarn(ms) {
  const $warn = $('refreshWarn');
  if ($warn) $warn.style.display = ms <= 100 ? 'block' : 'none';
}

function getPollMs() {
  // Guard: if _pollMs is NaN, 0, or negative → fall back to 5s default
  const ms = (typeof _pollMs === 'number' && _pollMs > 0 && isFinite(_pollMs)) ? _pollMs : 5000;
  return ms;
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

  initAdvancedSettings();
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

// ── Visibility-aware polling (tab hidden → pause, tab visible → resume) ──

let isVisible = true;

document.addEventListener('visibilitychange', () => {
  isVisible = !document.hidden;
  if (currentInbox) {
    if (isVisible) {
      fetchAndRenderMessages(); // Immediate fetch when returning
      startPoll();              // Restart polling with current interval
    } else {
      stopPoll();               // Pause when tab hidden
    }
  }
});
