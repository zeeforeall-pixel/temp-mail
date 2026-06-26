# VIP Flow PoC Report

> How VIP inbox creation works, why free users bypass it, and what to fix.

---

## 1. VIP End-to-End Flow

```
User clicks "Email+PW"
  → app.js:handleVipInbox()
    → api.js:createVipInbox(prefix, domain)
      → fetch('POST /api/create-inbox', {owner_token, desired_local, domain})
        → [Vercel Serverless fn]
          → supabaseAdmin (service_role key) INSERT into temp_inboxes
            → is_vip=true, password_plain=..., address=..., expires_at=...
        ← Returns {address, password, is_vip}
    → state.js:addHistoryEntry(inbox)
    → ui.js:renderVipCredentials()
      → Shows email, password, IMAP host/port, SMTP host/port
```

## 2. Why VIP Works for Any Free User

| Layer | Stops Free User? | Why |
|-------|:-:|------|
| Button hidden in UI | ❌ | Cosmetic — endpoint is directly callable |
| RLS `anon_insert_no_vip` | ❌ | Serverless fn uses `service_role` — RLS bypassed |
| Serverless auth check | ❌ **Missing** | No payment/signature verification |
| `owner_token` | ❌ | Client-generated UUID — not tied to real identity |

### PoC — Works from Any Browser Console

```js
// Free user bypass — no payment needed
const res = await fetch('/api/create-inbox', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    owner_token: crypto.randomUUID() + crypto.randomUUID(),
    desired_local: 'free.user.a1b2',
    domain: 'moyzel.foo'
  })
});
const inbox = await res.json();
console.log(inbox.password); // VIP creds leaked
```

## 3. Fixes by Priority

### P0 — Stop the Leak

| Fix | How |
|-----|-----|
| **Auth gate on serverless fn** | Verify API key or signed token before using `service_role` |
| **Rate limit VIP endpoint** | Max 5 VIP creates/hour per IP |

### P1 — Defense in Depth

| Fix | How |
|-----|-----|
| **Split endpoints** | `/api/create-inbox` (public) vs `/api/create-vip-inbox` (auth'd) |
| **Validate owner identity** | Tie `owner_token` to Supabase Auth user |

### P2 — Observability

| Fix | How |
|-----|-----|
| **Logging** | Log every VIP creation: IP, timestamp, UA |
| **Server-side circuit breaker** | Block IP after 10 VIP creates in 10min |

## 4. Root Cause

The serverless fn `/api/create-inbox` uses a `service_role` Supabase key that **bypasses all RLS policies**. This is necessary for server-side operations, but the endpoint itself has **no caller verification** — anyone with the URL can call it and get VIP creds.

RLS policies (`anon_insert_no_vip`, `password_plain` CHECK constraint) only block direct client-side Supabase inserts. They are irrelevant when the serverless fn uses `service_role`.
