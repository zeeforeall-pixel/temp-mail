# Temp Mail

A disposable email client with real-time message delivery, automatic OTP extraction, and multi-inbox management. Built with vanilla JavaScript and Supabase Realtime.

## Features

- **Instant inbox generation** with human-readable addresses
- **Real-time email delivery** via Supabase Realtime subscriptions
- **OTP auto-detection** extracts verification codes from incoming messages
- **Multi-inbox support** to manage several temporary addresses at once
- **Persistent history** with message counts stored in localStorage
- **Dark mode** toggle with system preference detection
- **Keyboard shortcuts** for common actions (R to refresh, C to copy address)

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
│   ├── theme.css
│   ├── components.css
│   └── layout.css
├── js/
│   ├── app.js
│   ├── api.js
│   ├── state.js
│   ├── ui.js
│   ├── otp.js
│   ├── sanitizer.js
│   └── config.js
└── package.json
```

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/zeeforeall-pixel/temp-mail.git
cd temp-mail
```

2. Install dependencies:

```bash
npm install
```

3. Configure Supabase credentials in `js/config.js`. Your Supabase project needs the required tables and RLS policies set up.

4. Run locally:

```bash
npm start
```

## Deployment

Deploy to Netlify:

```bash
npm run deploy
```

## Development Notes

- All application state is persisted to localStorage
- No build tooling — uses native ES modules for simplicity
- The OTP extractor (`js/otp.js`) and HTML sanitizer (`js/sanitizer.js`) are standalone modules that can be tested independently

## License

MIT
