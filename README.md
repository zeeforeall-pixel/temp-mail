# TempMail

Disposable email client with real-time message delivery, automatic OTP extraction, and multi-inbox management.

## Features

- **Instant inbox generation** with human-readable addresses
- **50ms polling** for near-instant message delivery
- **Real-time email delivery** via Supabase Realtime WebSocket subscriptions
- **OTP auto-detection** extracts verification codes from incoming messages
- **Verification link detection** identifies confirm/activate URLs
- **Multi-inbox support** to manage several temporary addresses at once
- **Bulk inbox creation** with stealth pipeline (token rotation, circuit breakers)
- **Persistent history** with message counts stored in localStorage
- **Dark mode** toggle
- **Keyboard shortcuts** — `R` to refresh, `C` to copy address, `Esc` to close modals
- **Programmatic Agent API** for headless automation and AI agents
- **URL-based API** for scriptable JSON responses

## Tech Stack

- **Frontend:** Vanilla JavaScript (ES modules), HTML5, CSS3
- **Backend:** Supabase (PostgreSQL, Realtime, Row Level Security)
- **Hosting:** Netlify
- **Zero build step** — runs directly in the browser with native module imports

## Project Structure

```
temp-mail/
├── index.html
├── css/
│   ├── theme.css          # CSS variables, dark mode
│   ├── components.css     # Buttons, modals, toasts, chips
│   └── layout.css         # Body, container, cards
├── js/
│   ├── config.js          # Constants, Supabase config, word lists
│   ├── state.js           # App state, localStorage persistence
│   ├── api.js             # Supabase client, inbox/message API calls
│   ├── otp.js             # OTP + verification link extraction
│   ├── sanitizer.js       # HTML email sanitizer (XSS prevention)
│   ├── ui.js              # DOM rendering, events, theme, keyboard shortcuts
│   ├── agent-api.js       # Programmatic API for automation (window.TempMailAPI)
│   └── app.js             # Init, wiring, polling, realtime subscriptions
├── test/
│   └── otp.test.mjs       # OTP extraction test suite (79 tests)
├── agent-api.json         # API discovery manifest for AI agents
├── .well-known/
│   └── ai-plugin.json     # ChatGPT plugin manifest
└── package.json
```

## Getting Started

```bash
git clone https://github.com/zeeforeall-pixel/temp-mail.git
cd temp-mail
npm install
npm test
```

## Agent API

### Browser Console / Automation

```js
const api = window.TempMailAPI;

// Generate email + wait for OTP in one flow
const session = await api.quickSession();
console.log('Email:', session.address);
const otp = await session.waitForOTP();
console.log('OTP:', otp.otp);
```

### URL API Mode (headless/scriptable)

Append to URL for JSON responses:

| Endpoint | Description |
|---|---|
| `?api=generate` | Generate new email → JSON |
| `?api=messages&address=x` | Get messages → JSON |
| `?api=otp&address=x` | Get OTP → JSON |
| `?api=wait&address=x&t=60` | Wait up to 60s for OTP → JSON |
| `?api=inboxes` | List all inboxes → JSON |
| `?api=domains` | List domains → JSON |

## Testing

```bash
npm test
```

## Deployment

```bash
npx netlify deploy --prod
```

## License

ISC
