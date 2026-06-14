# AGENTS.md

## Anti-Detection Playwright

This project has **playwright** patched to automatically use anti-detection plugins.
Any code that does `import { chromium } from "playwright"` or `require("playwright")` gets
**playwright-ghost + patchright** with recommended stealth plugins pre-applied.

### What's patched

- `node_modules/playwright/index.mjs` — ESM entry (redirects to playwright-ghost/patchright)
- `node_modules/playwright/index.js` — CJS entry (same, async init)
- Auto-reapplied on `npm install` via the `postinstall` script
- Stealth launch args (`--disable-blink-features=AutomationControlled`, etc.)

### Plugins applied by default

- `polyfill.automation` — removes `--enable-automation` flag
- `polyfill.headless` — fixes headless vs headful API differences
- `polyfill.screen` — realistic screen size (1920x1080)
- `polyfill.viewport` — varies viewport from screen
- `polyfill.userAgent` — clean Chrome UA (no "Headless")
- `humanize.click` — realistic mouse movements
- `humanize.cursor` — realistic cursor movements
- `humanize.dialog` — realistic dialog handling

### Stealth Module (`scripts/stealth.mjs`)

Advanced stealth for fingerprint-heavy sites (WhatsApp, etc.):

| Feature | What it does |
|---------|-------------|
| **Screen dimensions** | `screen.availHeight` differs from `screen.height` (1040 vs 1080) |
| **WebRTC blocking** | Blocks `RTCPeerConnection`, `getUserMedia`, `enumerateDevices` + CDP `WebRTC.Disable` |
| **Header ordering** | Reorders HTTP headers to match real Chrome via CDP `Fetch` domain |
| **AudioContext** | Adds micro-noise to `getChannelData` and `getFloatFrequencyData` |
| **Canvas fingerprint** | Adds pixel noise to `toDataURL`, `toBlob`, `readPixels` |
| **WebGL spoofing** | Spoofs `UNMASKED_VENDOR_WEBGL` and `UNMASKED_RENDERER_WEBGL` |
| **Client rects** | Adds micro-noise to `getBoundingClientRect` |
| **Global scope** | Hides automation properties from `Object.keys(window)` enumeration |
| **History length** | Spoofs `history.length` to simulate prior navigation |
| **Search navigation** | Navigates via Google first to set proper `document.referrer` |
| **Navigator props** | Spoofs `platform`, `hardwareConcurrency`, `deviceMemory` |
| **Permissions API** | Pass-through for `navigator.permissions.query` |

### Usage

#### Simple (no extra config needed)

```javascript
import { chromium } from "playwright"; // already patched!

const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext()).newPage();
await page.goto("https://example.com");
```

#### With full stealth (ghost-init / ghost-browser)

```javascript
import { launchGhost } from "./scripts/ghost-browser.mjs";

// Default stealth
const { browser, page } = await launchGhost({ url: "https://example.com" });

// WhatsApp-optimized stealth
const { browser, page } = await launchGhost({
  url: "https://web.whatsapp.com",
  whatsapp: true,
});

// Custom stealth options
const { browser, page } = await launchGhost({
  url: "https://example.com",
  stealthOptions: {
    screenWidth: 2560,
    screenHeight: 1440,
    availHeight: 1400,
    hardwareConcurrency: 16,
    historyLength: 3,
  },
});
```

#### CLI wrapper

```bash
# Basic
npm run ghost -- https://example.com --screenshot out.png

# With stealth overrides
npm run ghost -- https://example.com --eval "JSON.stringify({
  webdriver: navigator.webdriver,
  screen: { w: screen.width, h: screen.height, aw: screen.availWidth, ah: screen.availHeight },
  plugins: navigator.plugins.length,
  history: history.length
})"

# WhatsApp mode (search navigation + optimized stealth)
npm run ghost -- https://web.whatsapp.com --whatsapp
```

#### REPL

```javascript
await import("./scripts/ghost-init.mjs");
await ghost.launch({ url: "https://bot.sannysoft.com", whatsapp: true });
await ghost.evaluate(() => screen.availHeight);
await ghost.close();
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

Both pass SannySoft bot detection with all green checks:
- webdriver: hidden
- languages: set
- plugins: present
- screen dimensions: realistic (avail differs from screen)
- eval/toString: working
- history.length: >1 (via search navigation)

### Stealth API Reference

```javascript
import {
  stealthInitScript,    // Returns init script string for page.addInitScript()
  applyCDPStealth,      // Applies CDP-level stealth (WebRTC, headers)
  whatsappStealthOptions, // Returns optimized options for WhatsApp
  navigateViaSearch,    // Navigates via Google to set referrer
} from "./scripts/stealth.mjs";
```

### Maintenance

After `npm install`, the postinstall hook re-patches playwright automatically.
If playwright-ghost updates, run: `node scripts/ghost-postinstall.mjs`
