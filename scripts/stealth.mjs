// Stealth init scripts for anti-detection on WhatsApp and fingerprint-heavy sites.
// Apply via page.addInitScript() and CDP session commands.

export function stealthInitScript(options = {}) {
  const {
    screenWidth = 1920,
    screenHeight = 1080,
    availWidth = screenWidth,
    availHeight = screenHeight - 40,
    colorDepth = 24,
    pixelDepth = 24,
    platform = "MacIntel",
    hardwareConcurrency = 8,
    deviceMemory = 8,
    historyLength = null,
    blockWebRTC = true,
    spoofAudioContext = true,
    cleanGlobalScope = true,
    spoofCanvas = true,
    spoofWebGL = true,
    spoofClientRects = true,
    spoofPermissions = true,
  } = options;

  const hl = historyLength === null ? "null" : String(historyLength);

  return `(() => {
    const stealthOpts = {
      screenWidth: ${screenWidth},
      screenHeight: ${screenHeight},
      availWidth: ${availWidth},
      availHeight: ${availHeight},
      colorDepth: ${colorDepth},
      pixelDepth: ${pixelDepth},
      platform: "${platform}",
      hardwareConcurrency: ${hardwareConcurrency},
      deviceMemory: ${deviceMemory},
      historyLength: ${hl},
      blockWebRTC: ${blockWebRTC},
      spoofAudioContext: ${spoofAudioContext},
      cleanGlobalScope: ${cleanGlobalScope},
      spoofCanvas: ${spoofCanvas},
      spoofWebGL: ${spoofWebGL},
      spoofClientRects: ${spoofClientRects},
      spoofPermissions: ${spoofPermissions},
    };

    function overrideProp(obj, prop, value) {
      try {
        Object.defineProperty(obj, prop, {
          get: () => value,
          set: () => {},
          configurable: true,
          enumerable: true,
        });
      } catch (e) {}
    }

    // --- 1. Screen dimensions (consistent screen + avail) ---
    overrideProp(Screen.prototype, "width", stealthOpts.screenWidth);
    overrideProp(Screen.prototype, "height", stealthOpts.screenHeight);
    overrideProp(Screen.prototype, "availWidth", stealthOpts.availWidth);
    overrideProp(Screen.prototype, "availHeight", stealthOpts.availHeight);
    overrideProp(Screen.prototype, "colorDepth", stealthOpts.colorDepth);
    overrideProp(Screen.prototype, "pixelDepth", stealthOpts.pixelDepth);

    // Also override on the screen instance directly (CDP emulation sets instance props)
    if (window.screen) {
      overrideProp(window.screen, "width", stealthOpts.screenWidth);
      overrideProp(window.screen, "height", stealthOpts.screenHeight);
      overrideProp(window.screen, "availWidth", stealthOpts.availWidth);
      overrideProp(window.screen, "availHeight", stealthOpts.availHeight);
      overrideProp(window.screen, "colorDepth", stealthOpts.colorDepth);
      overrideProp(window.screen, "pixelDepth", stealthOpts.pixelDepth);
    }

    overrideProp(window, "innerWidth", stealthOpts.screenWidth);
    overrideProp(window, "innerHeight", stealthOpts.availHeight - 85);
    overrideProp(window, "outerWidth", stealthOpts.screenWidth);
    overrideProp(window, "outerHeight", stealthOpts.availHeight);
    overrideProp(window, "screenX", 0);
    overrideProp(window, "screenY", 0);
    overrideProp(window, "screenLeft", 0);
    overrideProp(window, "screenTop", 0);

    // --- 2. Navigator properties ---
    overrideProp(Navigator.prototype, "platform", stealthOpts.platform);
    overrideProp(Navigator.prototype, "hardwareConcurrency", stealthOpts.hardwareConcurrency);
    overrideProp(Navigator.prototype, "deviceMemory", stealthOpts.deviceMemory);
    overrideProp(Navigator.prototype, "maxTouchPoints", 0);

    // --- 3. WebRTC blocking ---
    if (stealthOpts.blockWebRTC) {
      const blockedErr = new DOMException("Permission denied", "NotAllowedError");
      window.RTCPeerConnection = function() { throw blockedErr; };
      window.RTCPeerConnection.prototype = {};
      window.webkitRTCPeerConnection = window.RTCPeerConnection;
      window.mozRTCPeerConnection = window.RTCPeerConnection;

      if (window.RTCDataChannel) window.RTCDataChannel = undefined;
      if (window.RTCSessionDescription) window.RTCSessionDescription = undefined;
      if (window.RTCIceCandidate) window.RTCIceCandidate = undefined;

      if (navigator.mediaDevices) {
        navigator.mediaDevices.getUserMedia = function() {
          return Promise.reject(blockedErr);
        };
        navigator.mediaDevices.enumerateDevices = function() {
          return Promise.resolve([]);
        };
      }

      if (navigator.getUserMedia) navigator.getUserMedia = undefined;
      if (navigator.webkitGetUserMedia) navigator.webkitGetUserMedia = undefined;
      if (navigator.mozGetUserMedia) navigator.mozGetUserMedia = undefined;
    }

    // --- 4. AudioContext fingerprint spoofing ---
    if (stealthOpts.spoofAudioContext) {
      const origAudioContext = window.AudioContext || window.webkitAudioContext;
      if (origAudioContext) {
        const origGetChannelData = AudioBuffer.prototype.getChannelData;
        AudioBuffer.prototype.getChannelData = function(...args) {
          const result = origGetChannelData.apply(this, args);
          let sum = 0;
          for (let i = 0; i < Math.min(result.length, 100); i++) sum += result[i];
          if (sum !== 0) {
            for (let i = 0; i < result.length; i++) {
              result[i] += (Math.random() - 0.5) * 1e-7;
            }
          }
          return result;
        };

        const origGetFloatFrequencyData = AnalyserNode.prototype.getFloatFrequencyData;
        if (origGetFloatFrequencyData) {
          AnalyserNode.prototype.getFloatFrequencyData = function(array) {
            origGetFloatFrequencyData.call(this, array);
            for (let i = 0; i < array.length; i++) {
              array[i] += (Math.random() - 0.5) * 1e-7;
            }
          };
        }
      }

      const origOffline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (origOffline) {
        const origStart = origOffline.prototype.startRendering;
        origOffline.prototype.startRendering = function() {
          return origStart.call(this).then(buffer => {
            for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
              const data = buffer.getChannelData(ch);
              for (let i = 0; i < data.length; i++) {
                data[i] += (Math.random() - 0.5) * 1e-7;
              }
            }
            return buffer;
          });
        };
      }
    }

    // --- 5. Canvas fingerprint noise ---
    if (stealthOpts.spoofCanvas) {
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      const origToBlob = HTMLCanvasElement.prototype.toBlob;
      const origGetImageData = CanvasRenderingContext2D.prototype.getImageData;

      function addCanvasNoise(canvas) {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const imgData = origGetImageData.call(ctx, 0, 0, canvas.width, canvas.height);
        for (let i = 0; i < imgData.data.length; i += 4) {
          imgData.data[i] ^= 1;
        }
        ctx.putImageData(imgData, 0, 0);
      }

      HTMLCanvasElement.prototype.toDataURL = function(...args) {
        addCanvasNoise(this);
        return origToDataURL.apply(this, args);
      };

      HTMLCanvasElement.prototype.toBlob = function(...args) {
        addCanvasNoise(this);
        return origToBlob.apply(this, args);
      };

      const origReadPixels = WebGLRenderingContext.prototype.readPixels;
      WebGLRenderingContext.prototype.readPixels = function(...args) {
        origReadPixels.apply(this, args);
        const pixels = args[6];
        if (pixels) {
          for (let i = 0; i < Math.min(pixels.length, 100); i++) {
            pixels[i] ^= 1;
          }
        }
      };
    }

    // --- 6. WebGL vendor/renderer spoofing ---
    if (stealthOpts.spoofWebGL) {
      function spoofWebGLParam(proto) {
        const orig = proto.getParameter;
        proto.getParameter = function(param) {
          const ext = this.getExtension("WEBGL_debug_renderer_info");
          if (ext) {
            if (param === ext.UNMASKED_VENDOR_WEBGL) return "Google Inc. (Apple)";
            if (param === ext.UNMASKED_RENDERER_WEBGL) return "ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)";
          }
          return orig.call(this, param);
        };
      }

      spoofWebGLParam(WebGLRenderingContext.prototype);
      if (window.WebGL2RenderingContext) {
        spoofWebGLParam(WebGL2RenderingContext.prototype);
      }
    }

    // --- 7. ClientRects / getBoundingClientRect noise ---
    if (stealthOpts.spoofClientRects) {
      const origGetBCR = Element.prototype.getBoundingClientRect;
      Element.prototype.getBoundingClientRect = function() {
        const rect = origGetBCR.call(this);
        const noise = () => (Math.random() - 0.5) * 0.1;
        return new DOMRect(
          rect.x + noise(),
          rect.y + noise(),
          rect.width + noise(),
          rect.height + noise(),
        );
      };
    }

    // --- 8. Permissions API ---
    if (stealthOpts.spoofPermissions) {
      const origQuery = Permissions.prototype.query;
      Permissions.prototype.query = function(descriptor) {
        return origQuery.call(this, descriptor);
      };
    }

    // --- 9. History length spoofing ---
    if (stealthOpts.historyLength !== null) {
      try {
        Object.defineProperty(History.prototype, "length", {
          get: () => stealthOpts.historyLength,
          configurable: true,
          enumerable: true,
        });
      } catch (e) {
        try {
          Object.defineProperty(window.history, "length", {
            get: () => stealthOpts.historyLength,
            configurable: true,
            enumerable: true,
          });
        } catch (e2) {}
      }
    }

    // --- 10. Global scope cleanup ---
    if (stealthOpts.cleanGlobalScope) {
      const hiddenKeys = new Set([
        "__playwright", "__pw_manual", "__pw_binding",
        "_phantom", "__nightmare", "callPhantom",
        "__selenium_unwrapped", "__webdriver_evaluate", "__driver_evaluate",
        "__webdriver_script_fn", "__fxdriver_evaluate", "__fxdriver_unwrapped",
        "_Selenium_IDE_Recorder",
        "cdc_adoQpoasnfa76pfcZLmcfl_Array",
        "cdc_adoQpoasnfa76pfcZLmcfl_Promise",
        "cdc_adoQpoasnfa76pfcZLmcfl_Symbol",
        "__chromedriver", "__webdriver_unwrapped",
        "domAutomationController", "domAutomation",
      ]);

      for (const key of hiddenKeys) {
        if (key in window) {
          try { delete window[key]; } catch (e) {}
        }
      }

      try {
        const origToString = Function.prototype.toString;
        Function.prototype.toString = function() {
          if (this === Function.prototype.toString) return "function toString() { [native code] }";
          if (this === window.RTCPeerConnection) return "function RTCPeerConnection() { [native code] }";
          return origToString.call(this);
        };
      } catch (e) {}

      try {
        const _origKeys = Object.keys;
        const _origGetOPN = Object.getOwnPropertyNames;
        Object.keys = function(obj) {
          const keys = _origKeys(obj);
          if (obj === window || obj === globalThis) {
            return keys.filter(k => !hiddenKeys.has(k));
          }
          return keys;
        };
        Object.getOwnPropertyNames = function(obj) {
          const names = _origGetOPN(obj);
          if (obj === window || obj === globalThis) {
            return names.filter(n => !hiddenKeys.has(n));
          }
          return names;
        };
      } catch (e) {}
    }

    // --- 11. chrome.runtime spoofing (real Chrome has this) ---
    if (!window.chrome) window.chrome = {};
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        connect: function() {},
        sendMessage: function() {},
        onMessage: { addListener: function() {}, removeListener: function() {} },
        onConnect: { addListener: function() {}, removeListener: function() {} },
      };
    }

    // --- 12. Plugins array (real Chrome has PDF plugins) ---
    if (navigator.plugins.length === 0) {
      try {
        const pdfPlugin = Object.create(Plugin.prototype);
        overrideProp(pdfPlugin, "name", "PDF Viewer");
        overrideProp(pdfPlugin, "description", "Portable Document Format");
        overrideProp(pdfPlugin, "filename", "internal-pdf-viewer");
        overrideProp(pdfPlugin, "length", 1);

        const pdfMime = Object.create(MimeType.prototype);
        overrideProp(pdfMime, "type", "application/pdf");
        overrideProp(pdfMime, "description", "Portable Document Format");
        overrideProp(pdfMime, "suffixes", "pdf");
        overrideProp(pdfPlugin, "0", pdfMime);

        overrideProp(Navigator.prototype, "plugins", {
          length: 1,
          0: pdfPlugin,
          item: (i) => i === 0 ? pdfPlugin : null,
          namedItem: (name) => name === "PDF Viewer" ? pdfPlugin : null,
          refresh: () => {},
          [Symbol.iterator]: function*() { yield pdfPlugin; },
        });
      } catch (e) {}
    }

    // --- 13. Languages ---
    if (navigator.languages.length === 0) {
      overrideProp(Navigator.prototype, "languages", ["en-US", "en"]);
    }
  })()`;
}

// CDP commands to apply after page creation for deeper stealth.
export async function applyCDPStealth(page, options = {}) {
  const { blockWebRTC = true, headerOrder = true } = options;
  const cdp = await page.context().newCDPSession(page);

  if (blockWebRTC) {
    try { await cdp.send("WebRTC.Disable"); } catch (e) {}
    try { await cdp.send("WebRtcAudio.Disable"); } catch (e) {}
  }

  if (headerOrder) {
    await cdp.send("Network.setExtraHTTPHeaders", {
      headers: {
        "sec-ch-ua": '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
      },
    });

    await cdp.send("Network.enable");

    await cdp.send("Fetch.enable", {
      patterns: [{ urlPattern: "*", requestStage: "Request" }],
    });

    cdp.on("Fetch.requestPaused", async (event) => {
      try {
        const headers = event.request.headers || {};
        const chromeOrder = [
          "host", "connection", "content-length",
          "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform",
          "upgrade-insecure-requests",
          "origin", "content-type",
          "accept",
          "sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest",
          "referer",
          "accept-encoding", "accept-language",
          "cookie",
        ];

        const lowerHeaders = {};
        for (const [k, v] of Object.entries(headers)) {
          lowerHeaders[k.toLowerCase()] = v;
        }

        const ordered = {};
        for (const key of chromeOrder) {
          if (key in lowerHeaders) ordered[key] = lowerHeaders[key];
        }
        for (const [k, v] of Object.entries(lowerHeaders)) {
          if (!(k in ordered)) ordered[k] = v;
        }

        await cdp.send("Fetch.continueRequest", {
          requestId: event.requestId,
          headers: Object.entries(ordered).map(([name, value]) => ({ name, value })),
        });
      } catch (e) {
        try {
          await cdp.send("Fetch.continueRequest", { requestId: event.requestId });
        } catch (e2) {}
      }
    });
  }

  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      delete navigator.__proto__.webdriver;
    `,
  });

  // Apply screen overrides after each navigation (CDP emulation overrides addInitScript)
  async function applyScreenOverrides() {
    try {
      await page.evaluate((opts) => {
        const { screenWidth, screenHeight, availWidth, availHeight, colorDepth, pixelDepth } = opts;
        const overrideProp = (obj, prop, value) => {
          try {
            Object.defineProperty(obj, prop, {
              get: () => value,
              set: () => {},
              configurable: true,
              enumerable: true,
            });
          } catch (e) {}
        };
        overrideProp(Screen.prototype, "width", screenWidth);
        overrideProp(Screen.prototype, "height", screenHeight);
        overrideProp(Screen.prototype, "availWidth", availWidth);
        overrideProp(Screen.prototype, "availHeight", availHeight);
        overrideProp(Screen.prototype, "colorDepth", colorDepth);
        overrideProp(Screen.prototype, "pixelDepth", pixelDepth);

        overrideProp(window, "innerWidth", screenWidth);
        overrideProp(window, "innerHeight", availHeight - 85);
        overrideProp(window, "outerWidth", screenWidth);
        overrideProp(window, "outerHeight", availHeight);
      }, { screenWidth, screenHeight, availWidth, availHeight, colorDepth, pixelDepth });
    } catch (e) {}
  }

  const screenWidth = options.screenWidth || 1920;
  const screenHeight = options.screenHeight || 1080;
  const availWidth = options.availWidth || screenWidth;
  const availHeight = options.availHeight || screenHeight - 40;
  const colorDepth = options.colorDepth || 24;
  const pixelDepth = options.pixelDepth || 24;

  page.on("load", () => { applyScreenOverrides(); });
  await applyScreenOverrides();

  return cdp;
}

// WhatsApp-specific stealth options (tuned for web.whatsapp.com).
export function whatsappStealthOptions() {
  return {
    screenWidth: 1920,
    screenHeight: 1080,
    availWidth: 1920,
    availHeight: 1040,
    colorDepth: 30,
    pixelDepth: 30,
    platform: "MacIntel",
    hardwareConcurrency: 10,
    deviceMemory: 8,
    historyLength: 2,
    blockWebRTC: true,
    spoofAudioContext: true,
    cleanGlobalScope: true,
    spoofCanvas: true,
    spoofWebGL: true,
    spoofClientRects: false,
    spoofPermissions: true,
  };
}

// Navigate with search engine referral to avoid window.history.length = 1.
export async function navigateViaSearch(page, url, searchQuery) {
  const domain = new URL(url).hostname;
  const query = searchQuery || domain.replace("www.", "").split(".")[0];
  const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;

  await page.goto(googleSearchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(1500 + Math.random() * 2000);
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
}

export default {
  stealthInitScript,
  applyCDPStealth,
  whatsappStealthOptions,
  navigateViaSearch,
};
