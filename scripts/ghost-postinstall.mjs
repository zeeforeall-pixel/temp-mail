#!/usr/bin/env node
import { writeFileSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(scriptsDir, "..");
const pwDir = join(projectDir, "node_modules", "playwright");

if (!existsSync(pwDir)) {
  console.log("playwright not installed, skipping ghost patch");
  process.exit(0);
}

const esmPatch = `// Patched by ghost-init: auto-apply anti-detection plugins to playwright
import { chromium as ghostChromium, firefox as ghostFirefox, webkit as ghostWebkit } from "playwright-ghost/patchright";
import plugins from "playwright-ghost/plugins";
import patchright from "patchright";

const DEFAULT_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

const defaultPlugins = [
  ...plugins.recommended(),
  plugins.polyfill.userAgent({ userAgent: DEFAULT_UA }),
];

const stealthArgs = [
  "--disable-blink-features=AutomationControlled",
  "--disable-features=IsolateOrigins,site-per-process",
  "--disable-infobars",
  "--no-first-run",
  "--no-default-browser-check",
];

function mergeArgs(opts) {
  if (!opts.args) opts.args = [];
  for (const a of stealthArgs) {
    if (!opts.args.includes(a)) opts.args.push(a);
  }
  return opts;
}

function wrapBrowserType(ghostBt) {
  return new Proxy(ghostBt, {
    get(target, prop) {
      const val = target[prop];
      if (typeof val === "function" && ["launch", "connect", "connectOverCDP", "launchPersistentContext", "launchServer"].includes(prop)) {
        return async function(...args) {
          const opts = args[0] || {};
          if (!opts.plugins) opts.plugins = defaultPlugins;
          args[0] = mergeArgs(opts);
          return val.apply(target, args);
        };
      }
      return typeof val === "function" ? val.bind(target) : val;
    },
  });
}

export const chromium = wrapBrowserType(ghostChromium);
export const firefox = wrapBrowserType(ghostFirefox);
export const webkit = wrapBrowserType(ghostWebkit);
export const selectors = patchright.selectors;
export const devices = patchright.devices;
export const errors = patchright.errors;
export const request = patchright.request;
export const _electron = patchright._electron;
export const _android = patchright._android;

const playwright = {
  chromium, firefox, webkit, selectors, devices, errors, request,
  _electron, _android,
};
export default playwright;
`;

const cjsPatch = `// Patched by ghost-init: auto-apply anti-detection plugins to playwright
const patchright = require("patchright");

let ghostModule = null;
let pluginsModule = null;
let defaultPlugins = null;

const stealthArgs = [
  "--disable-blink-features=AutomationControlled",
  "--disable-features=IsolateOrigins,site-per-process",
  "--disable-infobars",
  "--no-first-run",
  "--no-default-browser-check",
];

function mergeArgs(opts) {
  if (!opts.args) opts.args = [];
  for (const a of stealthArgs) {
    if (!opts.args.includes(a)) opts.args.push(a);
  }
  return opts;
}

async function init() {
  if (!ghostModule) {
    ghostModule = await import("playwright-ghost/patchright");
    pluginsModule = await import("playwright-ghost/plugins");
    const plugins = pluginsModule.default;
    defaultPlugins = [
      ...plugins.recommended(),
      plugins.polyfill.userAgent({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36" }),
    ];
  }
}

function wrapBrowserType(getGhostBt) {
  return new Proxy({}, {
    get(target, prop) {
      const ghostBt = getGhostBt();
      if (!ghostBt) return undefined;
      const val = ghostBt[prop];
      if (typeof val === "function" && ["launch", "connect", "connectOverCDP", "launchPersistentContext", "launchServer"].includes(prop)) {
        return async function(...args) {
          await init();
          const opts = args[0] || {};
          if (!opts.plugins) opts.plugins = defaultPlugins;
          args[0] = mergeArgs(opts);
          return val.apply(ghostBt, args);
        };
      }
      if (typeof val === "function") return val.bind(ghostBt);
      return val;
    },
  });
}

module.exports = {
  chromium: wrapBrowserType(() => ghostModule?.chromium),
  firefox: wrapBrowserType(() => ghostModule?.firefox),
  webkit: wrapBrowserType(() => ghostModule?.webkit),
  get selectors() { return patchright.selectors; },
  get devices() { return patchright.devices; },
  get errors() { return patchright.errors; },
  get request() { return patchright.request; },
  get _electron() { return patchright._electron; },
  get _android() { return patchright._android; },
};
`;

writeFileSync(join(pwDir, "index.mjs"), esmPatch);
writeFileSync(join(pwDir, "index.js"), cjsPatch);
console.log("ghost: playwright patched with anti-detection plugins + stealth launch args");
