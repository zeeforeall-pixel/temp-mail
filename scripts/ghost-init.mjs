// Auto-load playwright-ghost with anti-detection plugins for Node REPL.
// Usage in REPL: await import("./scripts/ghost-init.mjs")
// Then use: ghost.launch({ url }), ghost.page, ghost.browser, etc.

import { chromium } from "playwright-ghost/patchright";
import plugins from "playwright-ghost/plugins";
import {
  stealthInitScript,
  applyCDPStealth,
  whatsappStealthOptions,
  navigateViaSearch,
} from "./stealth.mjs";

const DEFAULT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

const ghost = {
  browser: null,
  context: null,
  page: null,

  async launch(options = {}) {
    if (this.browser) {
      console.log("Browser already running. Call ghost.close() first.");
      return this;
    }

    const {
      url,
      headless = true,
      userAgent = DEFAULT_UA,
      proxy,
      extraPlugins = [],
      stealth = true,
      stealthOptions = {},
      whatsapp = false,
    } = options;

    const launchOpts = {
      headless,
      plugins: [
        ...plugins.recommended(),
        plugins.polyfill.userAgent({ userAgent }),
        ...extraPlugins,
      ],
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
        "--disable-infobars",
        "--no-first-run",
        "--no-default-browser-check",
      ],
    };

    if (proxy) launchOpts.proxy = proxy;

    this.browser = await chromium.launch(launchOpts);

    const contextOptions = {
      userAgent,
      viewport: { width: 1920, height: 969 },
      screen: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      javaScriptEnabled: true,
      locale: "en-US",
      timezoneId: "Asia/Makassar",
      permissions: ["geolocation"],
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9",
        "sec-ch-ua": '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
      },
    };

    this.context = await this.browser.newContext(contextOptions);
    this.page = await this.context.newPage();

    if (stealth) {
      const opts = whatsapp ? whatsappStealthOptions() : stealthOptions;
      const initScript = stealthInitScript(opts);
      await this.page.addInitScript(initScript);
      await applyCDPStealth(this.page, {
        blockWebRTC: opts.blockWebRTC !== false,
        headerOrder: true,
      });
    }

    if (url) {
      if (stealth && stealthOptions.historyLength !== 0) {
        await navigateViaSearch(this.page, url, stealthOptions.searchQuery);
      } else {
        await this.page.goto(url, { waitUntil: "domcontentloaded" });
      }
      console.log("Navigated to: " + url);
    }

    return this;
  },

  async goto(url) {
    if (!this.page) throw new Error("No page. Call ghost.launch({ url }) first.");
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
    console.log("Navigated to: " + url);
    return this;
  },

  async evaluate(fn) {
    return this.page.evaluate(fn);
  },

  async screenshot(savePath) {
    const buf = await this.page.screenshot({ path: savePath, fullPage: true });
    console.log("Screenshot saved: " + (savePath || "(buffer)"));
    return buf;
  },

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
      this.page = null;
      console.log("Browser closed.");
    }
  },

  plugins,
  chromium,
  stealthInitScript,
  applyCDPStealth,
  whatsappStealthOptions,
  navigateViaSearch,
};

globalThis.ghost = ghost;
console.log("ghost loaded - ghost.launch({ url, whatsapp: true }), ghost.goto(), ghost.evaluate(), ghost.close()");

export default ghost;
