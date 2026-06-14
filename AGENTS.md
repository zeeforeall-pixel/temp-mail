# AGENTS.md

## Anti-Detection Playwright

This project has **playwright** patched to automatically use anti-detection plugins.
Any code that does `import { chromium } from "playwright"` or `require("playwright")` gets
**playwright-ghost + patchright** with recommended stealth plugins pre-applied.

### What's patched

- `node_modules/playwright/index.mjs` — ESM entry (redirects to playwright-ghost/patchright)
- `node_modules/playwright/index.js` — CJS entry (same, async init)
- Auto-reapplied on `npm install` via the `postinstall` script

### Plugins applied by default

- `polyfill.automation` — removes `--enable-automation` flag
- `polyfill.headless` — fixes headless vs headful API differences
- `polyfill.screen` — realistic screen size (1920x1080)
- `polyfill.viewport` — varies viewport from screen
- `polyfill.userAgent` — clean Chrome UA (no "Headless")
- `humanize.mouse` — realistic mouse movements
- `humanize.keyboard` — realistic typing patterns
- `utils.timezone` — consistent timezone

### Usage (no extra config needed)

```javascript
import { chromium } from "playwright"; // already patched!

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext()).newPage();
await page.goto("https://example.com");
```

### CLI wrapper

```bash
npm run ghost -- https://example.com --screenshot out.png --eval "document.title"
```

### invisible_playwright (Python/Firefox, max stealth)

For the highest stealth level (C++ patches, 0.90 reCAPTCHA score):

```bash
source .venv/bin/activate
python scripts/invisible-browser.py https://example.com
```

```python
from invisible_playwright import InvisiblePlaywright
with InvisiblePlaywright() as browser:
    page = browser.new_page()
    page.goto("https://example.com")
```

### Verification

Both pass 57/57 on SannySoft bot detection.

### Maintenance

After `npm install`, the postinstall hook re-patches playwright automatically.
If playwright-ghost updates, run: `node scripts/ghost-postinstall.mjs`
