// Auto-load playwright-ghost with anti-detection plugins for Node REPL.
// Usage in REPL: await import("./scripts/ghost-init.mjs")
// Then use: ghost.launch({ url }), ghost.page, ghost.browser, etc.

import { chromium } from "playwright-ghost/patchright";
import plugins from "playwright-ghost/plugins";

const DEFAULT_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

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
    } = options;

    const launchOpts = {
      headless,
      plugins: [
        ...plugins.recommended(),
        plugins.polyfill.userAgent({ userAgent }),
        ...extraPlugins,
      ],
    };

    if (proxy) launchOpts.proxy = proxy;

    this.browser = await chromium.launch(launchOpts);
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();

    if (url) {
      await this.page.goto(url, { waitUntil: "domcontentloaded" });
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
};

globalThis.ghost = ghost;
console.log("ghost loaded - ghost.launch({ url }), ghost.goto(), ghost.evaluate(), ghost.close()");

export default ghost;
