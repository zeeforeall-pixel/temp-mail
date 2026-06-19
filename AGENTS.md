# AGENTS.md

## Temp Mail Service

This project is a disposable email client with real-time message delivery, automatic OTP extraction, and multi-inbox management.

## Architecture

- **Frontend:** Vanilla JS (ES modules), HTML5, CSS3 — zero build step
- **Backend:** Supabase (PostgreSQL, Realtime, Row Level Security)
- **Hosting:** Netlify

## Project Structure

```
├── index.html          # Main UI (single-page)
├── css/                # Theme, components, layout
├── js/
│   ├── app.js          # Init, wiring, polling, realtime
│   ├── api.js          # Supabase client, inbox/message API
│   ├── state.js        # App state, localStorage
│   ├── config.js       # Constants, word lists, Supabase config
│   ├── ui.js           # DOM rendering, events
│   ├── otp.js          # OTP + verification link extraction
│   ├── sanitizer.js    # HTML email sanitizer
│   └── agent-api.js    # Programmatic API (window.TempMailAPI)
├── test/               # OTP test suite
└── package.json
```

## Key Concepts

- **Owner token:** Random UUID stored in localStorage, used for RLS-protected operations
- **Domain circuit breaker:** Domains that fail repeatedly are temporarily skipped
- **VIP inboxes:** Premium domains (moyzel.foo, moymoy.me, openfile.id) get IMAP/SMTP credentials
- **Realtime:** Supabase Realtime WebSocket subscriptions for instant message delivery
