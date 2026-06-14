#!/usr/bin/env node
// CLI wrapper: npm run ghost -- <url> [--eval <js>] [--screenshot <path>] [--whatsapp]
import { chromium } from "playwright";
import { stealthInitScript, applyCDPStealth, whatsappStealthOptions, navigateViaSearch } from "./stealth.mjs";

const args = process.argv.slice(2);
let url = "https://bot.sannysoft.com/";
let evalCode = null;
let screenshotPath = null;
let whatsapp = false;
let noStealth = false;
let searchQuery = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--eval" && args[i + 1]) { evalCode = args[++i]; }
  else if (args[i] === "--screenshot" && args[i + 1]) { screenshotPath = args[++i]; }
  else if (args[i] === "--search" && args[i + 1]) { searchQuery = args[++i]; }
  else if (args[i] === "--whatsapp") { whatsapp = true; }
  else if (args[i] === "--no-stealth") { noStealth = true; }
  else if (!args[i].startsWith("--")) { url = args[i]; }
}

console.log("ghost: launching anti-detect browser -> " + url);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1920, height: 969 },
  screen: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
  locale: "en-US",
  timezoneId: "Asia/Makassar",
  extraHTTPHeaders: {
    "Accept-Language": "en-US,en;q=0.9",
    "sec-ch-ua": '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
  },
});
const page = await context.newPage();

if (!noStealth) {
  const opts = whatsapp ? whatsappStealthOptions() : {};
  await page.addInitScript(stealthInitScript(opts));
  await applyCDPStealth(page);
}

if (whatsapp && !searchQuery) {
  searchQuery = "whatsapp web";
}

if (!noStealth && searchQuery) {
  await navigateViaSearch(page, url, searchQuery);
} else {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
}

await page.waitForTimeout(2000);

const title = await page.title();
const ua = await page.evaluate(() => navigator.userAgent);
const wd = await page.evaluate(() => navigator.webdriver);
const histLen = await page.evaluate(() => window.history.length);
const screenW = await page.evaluate(() => screen.width);
const screenH = await page.evaluate(() => screen.height);
const availW = await page.evaluate(() => screen.availWidth);
const availH = await page.evaluate(() => screen.availHeight);

console.log("Title: " + title);
console.log("UA: " + ua);
console.log("webdriver: " + wd);
console.log("Has Headless: " + ua.includes("Headless"));
console.log("history.length: " + histLen);
console.log("screen: " + screenW + "x" + screenH);
console.log("availScreen: " + availW + "x" + availH);

if (evalCode) {
  const result = await page.evaluate(evalCode);
  console.log("eval result:", JSON.stringify(result, null, 2));
}

if (screenshotPath) {
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log("Screenshot: " + screenshotPath);
}

await browser.close();
console.log("ghost: done");
