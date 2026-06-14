#!/usr/bin/env node
// CLI wrapper: npm run ghost -- <url> [--eval <js>] [--screenshot <path>]
import { chromium } from "playwright";

const args = process.argv.slice(2);
let url = "https://bot.sannysoft.com/";
let evalCode = null;
let screenshotPath = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--eval" && args[i + 1]) { evalCode = args[++i]; }
  else if (args[i] === "--screenshot" && args[i + 1]) { screenshotPath = args[++i]; }
  else if (!args[i].startsWith("--")) { url = args[i]; }
}

console.log("ghost: launching anti-detect browser -> " + url);

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(2000);

const title = await page.title();
const ua = await page.evaluate(() => navigator.userAgent);
const wd = await page.evaluate(() => navigator.webdriver);

console.log("Title: " + title);
console.log("UA: " + ua);
console.log("webdriver: " + wd);
console.log("Has Headless: " + ua.includes("Headless"));

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
