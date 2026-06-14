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

export async function launchGhost(options = {}) {
  const {
    headless = true,
    url,
    proxy,
    userAgent = DEFAULT_UA,
    extraPlugins = [],
    stealth = true,
    stealthOptions = {},
    whatsapp = false,
  } = options;

  const ghostPlugins = [
    ...plugins.recommended(),
    plugins.polyfill.userAgent({ userAgent }),
    ...extraPlugins,
  ];

  const launchOpts = {
    headless,
    plugins: ghostPlugins,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--disable-infobars",
      "--no-first-run",
      "--no-default-browser-check",
    ],
  };

  if (proxy) {
    launchOpts.proxy = proxy;
  }

  const browser = await chromium.launch(launchOpts);

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

  const context = await browser.newContext(contextOptions);

  const page = await context.newPage();

  if (stealth) {
    const opts = whatsapp ? whatsappStealthOptions() : stealthOptions;
    const initScript = stealthInitScript(opts);
    await page.addInitScript(initScript);
    await applyCDPStealth(page, {
      blockWebRTC: opts.blockWebRTC !== false,
      headerOrder: true,
    });
  }

  if (url) {
    if (stealth && stealthOptions.historyLength !== 0) {
      await navigateViaSearch(page, url, stealthOptions.searchQuery);
    } else {
      await page.goto(url, { waitUntil: "domcontentloaded" });
    }
  }

  return { browser, context, page };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2] || "https://bot.sannysoft.com/";
  console.log(`Launching ghost browser -> ${url}`);
  const { browser, page } = await launchGhost({ url });

  const title = await page.title();
  console.log(`Page title: ${title}`);
  console.log("Browser is open. Press Ctrl+C to close.");

  await new Promise(() => {});
}
