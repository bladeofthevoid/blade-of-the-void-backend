/**
 * shared/staticServer.js
 * -----------------------------------------------------------------------
 * Static file serving for the game client.
 *
 * Exports two functions:
 *
 *   serveIndexIfRoot(req, res, indexHtmlPath)
 *     Original API — unchanged, kept for backward compatibility.
 *     Callers that only need index.html can continue using this.
 *
 *   serveStatic(req, res, rootDir)
 *     Extended API — serves index.html AND /player/*.js ES modules.
 *     Call this instead when you want the player locomotion system
 *     to be importable from the browser without a bundler.
 *
 * Security: /player/ requests are validated against a strict pattern
 * (/player/<word chars>.js) before path.join so directory traversal
 * is structurally impossible, not just filtered.
 *
 * Both the gateway and any world server can serve the same static
 * assets — in a real deployment only the gateway serves them (per the
 * CLIENT -> Gateway -> World Server architecture), but world servers
 * serve them too so `node world/WorldServer.js` remains independently
 * runnable for local development.
 * -----------------------------------------------------------------------
 */

const fs   = require('fs');
const path = require('path');

/** Strict allowlist pattern for /player/ JS modules. */
const PLAYER_MODULE_RE = /^\/player\/[\w-]+\.js$/;

// ── Internal helpers ─────────────────────────────────────────────────────

function _serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      const code = err.code === 'ENOENT' ? 404 : 500;
      res.writeHead(code, { 'Content-Type': 'text/plain' });
      res.end(code === 404 ? 'Not found' : 'Internal server error');
      return;
    }
    res.writeHead(200, {
      'Content-Type': contentType,
      // Tell browsers they can cache these files for 10 minutes during
      // development; bump to a much longer TTL when assets are versioned.
      'Cache-Control': 'public, max-age=600',
    });
    res.end(data);
  });
  return true;  // request handled
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Original single-purpose helper — serves only /  and /index.html.
 * Kept for callers that haven't migrated to serveStatic() yet.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse}  res
 * @param {string} indexHtmlPath  Absolute path to index.html
 * @returns {boolean}  true if request was handled
 */
function serveIndexIfRoot(req, res, indexHtmlPath) {
  if (req.method !== 'GET') return false;
  if (req.url !== '/' && req.url !== '/index.html') return false;
  return _serveFile(res, indexHtmlPath, 'text/html');
}

/**
 * Extended static helper — serves index.html AND /player/*.js modules.
 * Use this in place of serveIndexIfRoot when the player locomotion
 * system lives in /player/ and needs to be importable as ES modules.
 *
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse}  res
 * @param {string} rootDir  Absolute path to the project root (the
 *                          directory that contains index.html and player/)
 * @returns {boolean}  true if request was handled
 */
function serveStatic(req, res, rootDir) {
  if (req.method !== 'GET') return false;

  // index.html
  if (req.url === '/' || req.url === '/index.html') {
    return _serveFile(res, path.join(rootDir, 'index.html'), 'text/html');
  }

  // /player/<name>.js  — strict pattern, no path traversal possible
  if (PLAYER_MODULE_RE.test(req.url)) {
    return _serveFile(
      res,
      path.join(rootDir, req.url.slice(1)),   // strip leading '/'
      'application/javascript; charset=utf-8'
    );
  }

  return false;  // not our request
}

module.exports = { serveIndexIfRoot, serveStatic };
