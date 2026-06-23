# 临时邮局 (Temp Mail) — Project Brain

> **URL:** https://xscope0.vercel.app  
> **Vercel Project:** `xscope0` (team: `zeeforeall-8344s-projects`)  
> **Owner:** @xscope0 (Telegram: https://t.me/xscope0)  
> **Type:** Static site (HTML + vanilla JS + CSS), deployed to Vercel  
> **Backend:** Supabase (anon key, public RLS)  

---

## Quick Deploy (copy-paste ready)

```bash
# Get Vercel token
TOKEN=$(cat ~/Library/Application\ Support/com.vercel.cli/auth.json | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")

# Deploy to production
cd /path/to/goofy-carson
vercel --prod --yes 2>&1

# If project stuck in UNKNOWN build status (Vercel platform bug):
# 1. Delete and recreate project
echo "y" | vercel project rm xscope0
vercel project add xscope0

# 2. Get new project ID and update config
NEW_ID=$(vercel api /v9/projects/xscope0 --scope zeeforeall-8344s-projects 2>&1 | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")

cat > .vercel/project.json << EOF
{"projectId":"$NEW_ID","orgId":"team_pS0azlz2O6b39eTzXqAHuDfu","projectName":"xscope0","settings":{"framework":null,"nodeVersion":"24.x"}}
EOF

# 3. Disable SSO protection (required for public access)
curl -s -X PATCH "https://api.vercel.com/v9/projects/xscope0?teamId=team_pS0azlz2O6b39eTzXqAHuDfu" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"ssoProtection":null}' > /dev/null 2>&1

# 4. Deploy
vercel --prod --yes

# 5. Set alias to xscope0.vercel.app
vercel alias set <deployment-url> xscope0.vercel.app
```

**Known Vercel issue:** Subsequent deploys to the same project often get stuck in `UNKNOWN` build status. The fix is to delete and recreate the project each deploy. The `ssoProtection: null` call is required or the site returns HTTP 401.

---

## Architecture

```
index.html          ← Main SPA (all views in one page)
css/
  theme.css         ← CSS variables, dark mode
  layout.css        ← Grid, responsive, mobile
  components.css    ← Cards, modals, buttons, GitHub Temp
  tokens.css        ← Design tokens
js/
  config.js         ← Supabase credentials (base64 encoded), constants, word lists
  state.js          ← App state management
  api.js            ← Supabase API calls (inbox CRUD, messages, domains)
  otp.js            ← OTP/verification code extraction from emails
  ui.js             ← DOM rendering, modals, toasts
  app.js            ← Main controller, event wiring, i18n, GitHub Temp logic
  agent-api.js      ← URL-mode API for external agents (?api=generate|messages|otp)
  sanitizer.js      ← HTML sanitization
```

### Data Flow
```
User clicks "Create Inbox"
  → api.js: createInbox(prefix, domain) → Supabase REST API
  → state.js: addHistoryEntry(inbox) → localStorage
  → ui.js: renderInbox(), renderInboxHistory()

Messages arrive
  → app.js: pollForMessages() every 10ms (POLL_INTERVAL_MS)
  → Supabase realtime subscription (postgres_changes on temp_messages)
  → otp.js: extractVerification(body) → finds 6-digit codes

GitHub Temp flow
  → Generate username (adj+noun+chinese+random) + password + inbox
  → Update "Open GitHub Signup" link with #xscope0fill=<base64> hash
  → Poll inbox for GitHub verification emails → extract OTP → display
```

---

## Key Features

### 1. Disposable Inbox
- Create temp email addresses on multiple domains
- Real-time message delivery via Supabase realtime
- OTP auto-extraction from verification emails
- Inbox history persisted in localStorage (up to 999 entries)

### 2. GitHub Temp (Step-by-step GitHub account creator)
- **Step 1:** Generate credentials (username + password + verification email)
- **Step 2:** Auto-Fill Script bookmarklet (fills GitHub join form)
- **Step 3:** OTP auto-detection (polls inbox for GitHub verification code)
- **Step 4:** 2FA setup instructions

### 3. VIP Inboxes (Imap/Smtp)
- Create inboxes with passwords for IMAP/SMTP access
- Server: `mail.{domain}` ports 993 (IMAP SSL) / 465 (SMTP SSL)
- Bulk CSV export

### 4. i18n (3 languages)
- 🇨🇳 Chinese (zh) — default
- 🇺🇸 English (en)
- 🇮🇩 Indonesian (id)
- All GitHub Temp text is translated via `data-i18n` attributes

### 5. Agent API
- URL mode: `?api=generate|messages|otp|wait|inboxes|domains`
- Returns JSON for programmatic access

---

## Security Hardening

| Measure | Implementation |
|---------|---------------|
| Supabase URL hidden | Base64 encoded via `atob()` in config.js |
| Supabase anon key hidden | Base64 encoded via `atob()` in config.js |
| No CSP meta tag | Removed from HTML (was exposing backend URL) |
| No DNS prefetch for Supabase | Removed from HTML |
| agent-api.json excluded | In `.vercelignore` (returns 404) |
| AI scrapers blocked | robots.txt blocks GPTBot, ClaudeBot, CCBot, Perplexity, etc. |
| X-Robots-Tag header | `noai, noimageai` |
| Framing blocked | `X-Frame-Options: DENY` |
| Referrer hidden | `Referrer-Policy: no-referrer` |
| Fingerprinting blocked | `Permissions-Policy: camera=(), microphone=(), geolocation=(), interest-cohort=(), browsing-topics=()` |
| Source files excluded | AGENTS.md, README.md, package.json, .hallmark/ all in `.vercelignore` |

---

## Supabase Tables (reference)

| Table | Purpose |
|-------|---------|
| `temp_inboxes` | Created inboxes with expiry |
| `temp_messages` | Incoming emails |
| `temp_domains` | Available email domains |

---

## Domain System

- **Premium domains:** `moyzel.foo`, `moymoy.me`, `openfile.id`
- **Crown domains:** `moyzel.foo` (special badge)
- **Bulk blacklist:** `moymoy.me`, `openfile.id`
- Domain rotation via `getEffDomain()` (weighted random)

---

## Prefix Generator

Format: `adjective.noun.randomSuffix`  
- ~170 English adjectives + ~170 English nouns  
- 30 Chinese adjectives (灵,快,静,暗,明,烈...) + 30 Chinese nouns (龙,凤,虎,鹤,狐...)  
- Random 4-5 char alphanumeric suffix  
- Total combinations: ~1.8 billion unique names

---

## Branding Rules

- Site name: **临时邮局** (Temp Mail in Chinese)
- Credit: **疯子 xscope0** (always keep 疯子, xscope0 always lowercase)
- Footer: `[xscope0] @xscope0 · 疯子 xscope0 · 黑夜邮局`
- VIP badge: `VIP · 疯子 xscope0`
- Cracked label: `Cracked — 疯子 xscope0`
- Tagline varies by language but always includes `疯子 xscope0`

---

## File Exclusions (.vercelignore)

These files are NEVER deployed:
```
node_modules, .venv, .fallow, .netlify, .vercel, *.log, .DS_Store,
scripts/, js/__tests__/, agent-api.json, index.html.bak, AGENTS.md,
README.md, .hallmark/, package.json, package-lock.json, favicon_backup.png
```

---

## Common Tasks

### Add a new language
1. Add flag emoji button in `index.html` language switcher
2. Add translation object in `I18N` in `app.js`
3. All translatable elements use `data-i18n="key"` attributes
4. The `applyLanguage()` function handles both `textContent` and `innerHTML` (for keys containing `<` tags)

### Add a new domain
Add to Supabase `temp_domains` table. The frontend auto-fetches domains.

### Change polling speed
Edit `POLL_INTERVAL_MS` in `config.js` (currently 10ms for near-instant updates).

### Update the Auto-Fill Script bookmarklet
The bookmarklet is a `javascript:` URL in `index.html`. It reads `#xscope0fill=<base64(JSON)>` from the URL hash, then fills `#email`, `#password`, `#login` on GitHub's signup page with human-like typing simulation.

---

## Known Issues / Gotchas

1. **Vercel UNKNOWN builds:** Vercel's build pipeline frequently gets stuck on subsequent deploys to the same project. Solution: delete and recreate the project each time.
2. **SSO protection:** Vercel team has SSO protection enabled by default. Must call API to set `ssoProtection: null` after creating a new project, or the site returns 401.
3. **GitHub signup redirect:** `github.com/signup` redirects to `github.com/join` and strips URL hash. Always use `github.com/join` for the signup link.
4. **COEP header:** `Cross-Origin-Embedder-Policy: require-corp` breaks Supabase connections. Do NOT add this header.

---

## VIP Security Architecture

### How VIP inboxes are created (secure flow)

```
Client → sb.functions.invoke('generate-vip-inbox')
       → Supabase Edge Function (server-side, uses service_role key)
       → Inserts into temp_inboxes with is_vip=true + password
       → Returns {address, password, is_vip}
```

### RLS Policies (what anon clients CANNOT do)

| Action | Allowed? | Policy |
|--------|----------|--------|
| Insert normal inbox | ✅ | Must have address, domain, owner_token |
| Set `is_vip=true` directly | ❌ | Blocked by `anon_insert_no_vip` policy |
| Set `password_plain` directly | ❌ | Blocked by same policy + CHECK constraint |
| Read inboxes | ✅ | Public (disposable inboxes) |
| Read messages | ✅ | Public (anyone with the address) |
| Read domains | ✅ | Public |

### Edge Function Deployment

The `generate-vip-inbox` Edge Function lives at:
```
supabase/functions/generate-vip-inbox/index.ts
```

Deploy with:
```bash
supabase functions deploy generate-vip-inbox
```

### SQL Migration

RLS policy fixes are at:
```
supabase/migrations/2024_fix_rls_policies.sql
```

Run in Supabase SQL Editor to apply.

### Agent API VIP Endpoint

URL mode: `?api=vip[&prefix=x][&domain=y]`

Returns:
```json
{
  "address": "swift.fox.k7m2@moymoy.me",
  "expires_at": "2026-06-17T00:00:00Z",
  "password": "aB3!xYz...16chars",
  "is_vip": true,
  "imap": {"host": "mail.moymoy.me", "port": 993, "encryption": "SSL/TLS"},
  "smtp": {"host": "mail.moymoy.me", "port": 465, "portAlt": 587, "encryption": "SSL/TLS", "encryptionAlt": "STARTTLS"}
}
```
