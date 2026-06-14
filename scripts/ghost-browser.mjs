import { chromium } from "playwright-ghost/patchright";
import plugins from "playwright-ghost/plugins";

export async function launchGhost(options = {}) {
  const {
    headless = true,
    url,
    proxy,
    userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    extraPlugins = [],
  } = options;

  const browser = await chromium.launch({
    headless,
    plugins: [
      ...plugins.recommended(),
      plugins.polyfill.userAgent({ userAgent }),
      ...extraPlugins,
    ],
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  if (url) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
  }

  return { browser, context, page };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2] || "https://bot.sannysoft.com/";
  console.log(`Launching ghost browser → ${url}`);
  const { browser, page } = await launchGhost({ url });

  const title = await page.title();
  console.log(`Page title: ${title}`);
  console.log("Browser is open. Press Ctrl+C to close.");

  await new Promise(() => {});
}
