/**
 * config.js — Application configuration and constants.
 *
 * WARNING: The Supabase anon key is intentionally public (client-side).
 * Security relies on Row-Level Security (RLS) policies on the Supabase side.
 * NEVER replace this with a service_role key — that would expose full DB access.
 */

// ── Supabase credentials ──

export const SB_URL = 'https://ijrccpgiulrmfpavazsl.supabase.co';

// WARNING: anon keys in client code are public. Use RLS policies.
export const SB_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlqcmNjcGdpdWxybWZwYXZhenNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2NDMwNTUsImV4cCI6MjA4ODIxOTA1NX0.ljpHFR3iy8hIqU2ddOCwKmP77xbN8-lk8MpCpuPO6tc';

// Runtime guard: warn if someone accidentally pastes a service_role key
if (SB_ANON_KEY.includes('service_role')) {
  console.error(
    '🚨 SECURITY: A service_role key was detected in SB_ANON_KEY. ' +
    'This exposes full database access. Replace it with the anon key immediately.'
  );
}

// ── Limits & thresholds ──

export const MAX_INBOX_HISTORY = 999;
export const MAX_BULK_COUNT = 99;
export const MAX_VIP_BULK_COUNT = 100;
export const BULK_CONCURRENCY = 100;
export const MAX_INBOX_RETRIES = 12;
export const MAX_GEN_RETRIES = 5;
export const RETRY_DELAY_MS = 300;
export const POLL_INTERVAL_MS = 10;
export const MESSAGE_FETCH_LIMIT = 100;
export const EXPIRY_WARNING_MS = 10 * 60 * 1000;       // 10 minutes
export const EXPIRY_TICK_INTERVAL_MS = 30 * 1000;       // 30 seconds

// ── LocalStorage keys ──

export const LS_OWNER_TOKEN = 'tm_owner';
export const LS_HISTORY = 'tm_history';
export const LS_DOMAIN = 'tm_domain';
export const LS_DARK_MODE = 'tm_dark';
export const LS_SEEN_MESSAGES = 'tm_seen_messages';
export const LS_VIP_PASSWORDS = 'tm_vip_pw';

// ── Domain blacklist (skipped during bulk creation only) ──

export const BULK_BLACKLIST = ['moymoy.me', 'openfile.id'];

export const PREMIUM_DOMAINS = ['moyzel.foo', 'moymoy.me', 'openfile.id', 'moyvip.com'];
export const CROWN_DOMAINS = ['moyzel.foo', 'moyvip.com'];
// ── Word lists for human-readable prefix generation ──
// Two large word pools: adjectives and nouns. Combined with a random
// suffix to guarantee uniqueness across billions of combinations.
// Format: adj.noun.rand (e.g., "swift.fox.k7m2")

const ADJECTIVES = [
  'swift','bright','calm','dark','eager','fair','glad','hale','idle',
  'just','keen','live','mild','neat','open','pure','quick','rare',
  'safe','tall','vast','warm','young','bold','cool','deep','easy',
  'fine','glow','high','iron','jazz','kind','lean','mere','next',
  'okay','pale','real','slim','true','used','vital','wise','zero',
  'agile','brave','clean','dizzy','early','flash','grand','happy',
  'inner','jolly','knack','lucky','magic','noble','outer','prime',
  'quiet','ready','sharp','tidy','ultra','vivid','witty','zesty',
  'amber','blunt','crisp','dense','exact','frost','gloss','hardy',
  'ivory','jumpy','kinky','lucid','minty','novel','olive','plush',
  'rapid','snowy','tangy','urban','vocal','whirl','zippy','azure',
  'breezy','candid','dreamy','elated','fierce','golden','heroic',
  'icy','jaunty','kooky','lush','moody','niche','ornate','peppy',
  'quirky','rustic','sleek','tough','united','vibrant','wobbly',
  'zonal','ancient','basic','cosmic','dapper','electric','fluid',
  'gentle','hollow','indigo','jagged','knotty','liquid','mellow',
  'nimble','oceanic','polished','radiant','savage','tender','upbeat',
  'velvet','wicked','xenial','youthful','zealous','arid','bumpy',
  'cheery','dusty','elastic','fancy','giddy','hidden','jolly',
  'kempt','lively','merry','nifty','optic','placid','random',
  'spicy','trippy','upright','valiant','wiry','zealous','alert',
  'balanced','crafty','divine','epic','fresh','glib','humble',
  'intrepid','jovial','keen','lucid','modest','nippy','odd',
  'primal','regal','subtle','trim','utter','vexed','wary','young',
];

const NOUNS = [
  'fox','owl','bear','wolf','deer','hawk','lynx','swan','crow',
  'dove','pike','wren','hare','lark','moth','newt','puma','seal',
  'toad','vole','yak','ape','bat','bee','cat','cod','eel','elk',
  'emu','fly','gnu','hen','jay','koi','ram','ray','tit','asp',
  'ant','boa','bug','cub','doe','fin','hog','imp','kit','lab',
  'ace','bay','cove','dale','dune','fern','gale','glen','grove',
  'isle','lake','leaf','mesa','peak','pine','pond','reef','rift',
  'sage','shoal','stone','tide','vale','vine','wave','arch','basin',
  'bluff','brook','canyon','cliff','creek','delta','drift','ember',
  'field','fjord','flame','frost','glade','gorge','haven','ledge',
  'marsh','meadow','ridge','river','shore','slope','spark','spring',
  'storm','summit','swamp','trail','tundra','vista','woods','atlas',
  'bolt','charm','comet','dawn','dusk','echo','flint','glyph',
  'halo','haze','jewel','karma','lotus','marble','mist','nebula',
  'nova','onyx','opal','orbit','pearl','pixel','prism','pulse',
  'quartz','rune','saber','shade','silk','solar','spark','steel',
  'stone','swift','thorn','torch','trace','venom','vigor','vortex',
  'cipher','arrow','badge','blade','bloom','breeze','cedar','cloud',
  'coral','crane','crest','crux','depth','drake','eagle','falcon',
  'flare','forge','ghost','gleam','glint','grain','grove','heron',
  'ivory','lance','maple','nexus','oasis','osprey','otter','panda',
  'phoenix','pixel','raven','robin','sable','scarab','shadow','slate',
  'sparrow','stork','tiger','topaz','tulip','viper','willow','zephyr',
];

const SUFFIX_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

// ── Domain circuit breaker thresholds ──

export const DOMAIN_CIRCUIT_BREAKER_THRESHOLD = 4;
export const DOMAIN_CIRCUIT_BREAKER_COOLDOWN_MS = 8000;

// ── SVG icon strings (trusted internal HTML — never user-supplied) ──

export const ICONS = {
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
  dice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><circle cx="15.5" cy="8.5" r="1.5"/><circle cx="15.5" cy="15.5" r="1.5"/><circle cx="8.5" cy="15.5" r="1.5"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
  empty: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><rect x="8" y="8" width="14" height="14" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
  reset: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  clipboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>',
  key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>',
  crown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><path d="M2 4l3 12h14l3-12-6 7-4-7-4 7-6-7zm3 16h14"/></svg>',
};

// ── Human-readable prefix generator ──
// Format: adj.noun.random (e.g., "swift.fox.k7m2")
// Uses dedup set to guarantee no collisions within a session.
// Space: ~170 adj × ~170 nouns × 36^5 random = ~1.8 billion unique names

const usedPrefixes = new Set();

export function genHumanPrefix() {
  const maxAttempts = 50;
  for (let i = 0; i < maxAttempts; i++) {
    const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
    const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
    // Random 4-5 char alphanumeric suffix
    const suffixLen = 4 + Math.floor(Math.random() * 2);
    let suffix = '';
    for (let j = 0; j < suffixLen; j++) {
      suffix += SUFFIX_CHARS[Math.floor(Math.random() * SUFFIX_CHARS.length)];
    }
    if (!/\d/.test(suffix)) {
      const pos = Math.floor(Math.random() * suffix.length);
      suffix = suffix.slice(0, pos) + Math.floor(Math.random() * 10) + suffix.slice(pos + 1);
    }
    const prefix = `${adj}.${noun}.${suffix}`;
    if (!usedPrefixes.has(prefix)) {
      usedPrefixes.add(prefix);
      return prefix;
    }
  }
  // Fallback: append timestamp if somehow exhausted (virtually impossible)
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}.${noun}.${Date.now().toString(36)}`;
}

/**
 * Reset the dedup set (call when starting a new bulk batch).
 */
export function resetPrefixDedup() {
  usedPrefixes.clear();
}

// ── IMAP/SMTP Server Configuration ──

export const IMAP_HOST = 'mail.{domain}';
export const IMAP_PORT = 993;
export const IMAP_ENCRYPTION = 'SSL/TLS';
export const SMTP_HOST = 'mail.{domain}';
export const SMTP_PORT = 465;
export const SMTP_ENCRYPTION = 'SSL/TLS';
export const SMTP_PORT_ALT = 587;
export const SMTP_ENCRYPTION_ALT = 'STARTTLS';

// ── Password generator for VIP inboxes ──

const PW_CHARS_ALPHA = 'abcdefghijklmnopqrstuvwxyz';
const PW_CHARS_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PW_CHARS_DIGIT = '0123456789';
const PW_CHARS_SPECIAL = '!@#$%&*';
const PW_CHARS_ALL = PW_CHARS_ALPHA + PW_CHARS_UPPER + PW_CHARS_DIGIT + PW_CHARS_SPECIAL;

/**
 * Generate a strong random password for IMAP/SMTP login.
 * Format: 16 chars with guaranteed mix of upper, lower, digit, special.
 */
export function generateInboxPassword(length = 16) {
  const pw = new Array(length);
  pw[0] = PW_CHARS_ALPHA[Math.floor(Math.random() * PW_CHARS_ALPHA.length)];
  pw[1] = PW_CHARS_UPPER[Math.floor(Math.random() * PW_CHARS_UPPER.length)];
  pw[2] = PW_CHARS_DIGIT[Math.floor(Math.random() * PW_CHARS_DIGIT.length)];
  pw[3] = PW_CHARS_SPECIAL[Math.floor(Math.random() * PW_CHARS_SPECIAL.length)];
  for (let i = 4; i < length; i++) {
    pw[i] = PW_CHARS_ALL[Math.floor(Math.random() * PW_CHARS_ALL.length)];
  }
  for (let i = pw.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pw[i], pw[j]] = [pw[j], pw[i]];
  }
  return pw.join('');
}

/**
 * Get IMAP/SMTP connection info for a domain.
 * @param {string} domain - The email domain.
 * @returns {{ imap: object, smtp: object }}
 */
export function getMailServerInfo(domain) {
  const host = IMAP_HOST.replace('{domain}', domain);
  return {
    imap: { host, port: IMAP_PORT, encryption: IMAP_ENCRYPTION },
    smtp: {
      host: SMTP_HOST.replace('{domain}', domain),
      port: SMTP_PORT,
      portAlt: SMTP_PORT_ALT,
      encryption: SMTP_ENCRYPTION,
      encryptionAlt: SMTP_ENCRYPTION_ALT,
    },
  };
}
