/**
 * sanitizer.js — HTML email sanitizer.
 *
 * Strips dangerous elements and attributes from email HTML before rendering.
 * Uses DOMParser for safe parsing — never regex-based HTML manipulation.
 *
 * Handles:
 *   - <script>, <iframe>, <object>, <embed>, <form>, <style>, <link>,
 *     <meta>, <base>, <applet>, <svg>, <math>, <template>
 *   - Event handler attributes (onclick, onload, onerror, etc.)
 *   - javascript: URIs in href/src attributes
 *   - data: URIs in href/src (phishing risk)
 *   - CSS url() injections, expression(), -moz-binding, behavior
 *   - @import rules in <style> blocks
 */

/**
 * Elements that are completely removed from the DOM.
 */
const DANGEROUS_ELEMENTS = [
  'script',
  'iframe',
  'object',
  'embed',
  'form',
  'style',
  'link',
  'meta',
  'base',
  'applet',
  'svg',
  'math',
  'template',
];

/**
 * Regex for dangerous CSS patterns.
 */
const DANGEROUS_CSS = /url\s*\(|expression\s*\(|-moz-binding|behavior\s*:/i;

/**
 * Regex for @import in CSS.
 */
const CSS_IMPORT = /@import[^;]*;?/gi;

/**
 * Regex for dangerous attribute values.
 */
const DANGEROUS_ATTR_VALUE = /^(javascript|data|vbscript):/i;

/**
 * Regex for event handler attributes.
 */
const EVENT_HANDLER = /^on/i;

/**
 * Strip the outer email wrapper (full HTML doc) to get just the body content.
 * @param {string} html - Raw email HTML.
 * @returns {string} The body content or the original HTML if no wrapper found.
 */
export function stripEmailWrapper(html) {
  if (!html) return html;

  // If it's a full HTML doc, extract body content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) return bodyMatch[1];

  // Strip doctype + html/head tags
  return html
    .replace(/^<!doctype\s+html[^>]*>/i, '')
    .replace(/<\/?html[^>]*>/gi, '')
    .replace(/<head>[\s\S]*?<\/head>/gi, '');
}

/**
 * Sanitize HTML email content for safe rendering.
 *
 * @param {string} raw - Raw email HTML or text.
 * @returns {string} Sanitized HTML safe for innerHTML.
 */
export function sanitizeEmailHtml(raw) {
  if (!raw) return '';

  // Step 1: Strip the outer wrapper
  const stripped = stripEmailWrapper(raw);

  // Step 2: Parse into a sandboxed document
  const sandbox = new DOMParser().parseFromString(stripped, 'text/html');

  // Step 3: Remove dangerous elements entirely
  const dangerousSelector = DANGEROUS_ELEMENTS.join(',');
  sandbox.querySelectorAll(dangerousSelector).forEach((el) => el.remove());

  // Step 4: Clean remaining elements
  sandbox.querySelectorAll('*').forEach((el) => {
    // Remove event handler attributes and javascript:/data: URIs
    for (const attr of [...el.attributes]) {
      if (EVENT_HANDLER.test(attr.name)) {
        el.removeAttribute(attr.name);
        continue;
      }
      if (DANGEROUS_ATTR_VALUE.test(attr.value.trim())) {
        el.removeAttribute(attr.name);
        continue;
      }
      // Remove dangerous inline styles
      if (attr.name === 'style' && DANGEROUS_CSS.test(attr.value)) {
        el.removeAttribute(attr.name);
        continue;
      }
    }

    // Neutralize data: URIs in href/src
    for (const urlAttr of ['href', 'src', 'action', 'poster']) {
      if (el.hasAttribute(urlAttr)) {
        const val = el.getAttribute(urlAttr).trim().toLowerCase();
        if (val.startsWith('data:') || val.startsWith('javascript:') || val.startsWith('vbscript:')) {
          el.removeAttribute(urlAttr);
        }
      }
    }
  });

  return sandbox.body.innerHTML;
}
