/**
 * tests/_extractClientModules.js
 * -----------------------------------------------------------------------
 * index.html has no build step and no module exports -- it's one inline
 * <script type="module"> block. To unit-test its NetworkManager class
 * without a browser, this pulls the relevant class/function definitions
 * directly out of index.html's source text (via brace-matching, skipping
 * over string/template-literal/comment content so embedded `{`/`}`
 * characters in error messages or comments can't throw off the count)
 * and evaluates them in a sandboxed CommonJS module.
 *
 * This deliberately does NOT hand-maintain a second copy of
 * NetworkManager for testing -- that would silently drift from the real
 * client code the moment someone edited index.html. Extraction guarantees
 * the tests always exercise exactly what ships.
 * -----------------------------------------------------------------------
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/** Finds the `{` at/after `fromIndex` and returns the index just past its matching `}`. */
function findBlockEnd(src, fromIndex) {
  const openIdx = src.indexOf('{', fromIndex);
  let depth = 0;
  let i = openIdx;
  for (; i < src.length; i++) {
    const ch = src[i];

    // Skip over string/template literals and comments so a stray
    // `{`/`}` inside one of them (e.g. in an error message) can't
    // desynchronize the brace count.
    if (ch === '/' && src[i + 1] === '/') {
      i = src.indexOf('\n', i);
      if (i === -1) break;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i) + 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++; // skip escaped char
        i++;
      }
      continue;
    }

    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error('findBlockEnd: unbalanced braces starting at ' + fromIndex);
}

function extractDefinition(src, marker) {
  const start = src.indexOf(marker);
  if (start === -1) throw new Error(`Could not find "${marker}" in index.html's client script.`);
  const end = findBlockEnd(src, start);
  return src.slice(start, end);
}

/**
 * @returns {{ MessageTypes: object, NetworkManager: Function, buildWsUrl: Function }}
 */
function extractClientNetworkModules() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const scriptMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!scriptMatch) throw new Error('Could not find the client <script type="module"> block in index.html.');
  const src = scriptMatch[1];

  const messageTypesSrc = extractDefinition(src, 'const MessageTypes');
  const networkManagerSrc = extractDefinition(src, 'class NetworkManager');
  const buildWsUrlSrc = extractDefinition(src, 'function buildWsUrl');

  const sandboxSrc = `
    ${messageTypesSrc}
    ${networkManagerSrc}
    ${buildWsUrlSrc}
    module.exports = { MessageTypes, NetworkManager, buildWsUrl };
  `;

  const sandboxModule = { exports: {} };
  const context = {
    module: sandboxModule,
    exports: sandboxModule.exports,
    require,
    console,
    WebSocket: global.WebSocket,
    performance: global.performance,
    ClientConfig: global.ClientConfig,
    URLSearchParams: global.URLSearchParams,
    setInterval,
    clearInterval,
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(sandboxSrc, context, { filename: 'index.html (extracted)' });
  return sandboxModule.exports;
}

module.exports = { extractClientNetworkModules };
