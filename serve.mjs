import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

// ── RATE LIMITING ────────────────────────────────────────────────────────────
// Sliding-window: max 120 requests per IP per minute.
const RATE_LIMIT_MAX    = 120;
const RATE_LIMIT_WINDOW = 60_000; // ms

const rateLimitStore = new Map(); // ip → [timestamp, ...]

function isRateLimited(ip) {
  const now       = Date.now();
  const cutoff    = now - RATE_LIMIT_WINDOW;
  const hits      = (rateLimitStore.get(ip) ?? []).filter(t => t > cutoff);
  hits.push(now);
  rateLimitStore.set(ip, hits);
  return hits.length > RATE_LIMIT_MAX;
}

// Prune stale entries every minute so the map doesn't grow unboundedly.
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW;
  for (const [ip, hits] of rateLimitStore) {
    const fresh = hits.filter(t => t > cutoff);
    if (fresh.length === 0) rateLimitStore.delete(ip);
    else rateLimitStore.set(ip, fresh);
  }
}, RATE_LIMIT_WINDOW).unref();

// ── SECURITY HEADERS ─────────────────────────────────────────────────────────
// Applied to every response, including errors.
// CSP allows the two CDNs (Tailwind, Google Fonts) this site depends on.
// 'unsafe-inline' for styles is required by Tailwind's CDN build.
const SECURITY_HEADERS = {
  'X-Content-Type-Options':  'nosniff',
  'X-Frame-Options':         'SAMEORIGIN',
  'X-XSS-Protection':        '1; mode=block',
  'Referrer-Policy':         'strict-origin-when-cross-origin',
  'Permissions-Policy':      'camera=(), microphone=(), geolocation=(), payment=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com",
    "style-src  'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src   'self' https://fonts.gstatic.com",
    "img-src    'self' data: blob:",
    "connect-src 'self'",
    "frame-ancestors 'self'",
  ].join('; '),
};

// ── MIME TYPES ───────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.mjs':  'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
};

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain', ...SECURITY_HEADERS });
  res.end(body);
}

// ── SERVER ───────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {

  // Only serve GET and HEAD — reject anything else at the door.
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method Not Allowed');
  }

  // Rate limit by remote IP.
  const ip = req.socket.remoteAddress ?? 'unknown';
  if (isRateLimited(ip)) {
    res.setHeader('Retry-After', '60');
    return send(res, 429, 'Too Many Requests — please wait a moment.');
  }

  // Strip query string, default to index.
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  // Decode percent-encoding; reject malformed URIs.
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return send(res, 400, 'Bad Request');
  }

  // Normalise and resolve against project root.
  const filePath = path.normalize(path.join(__dirname, decoded));

  // Path-traversal guard: resolved path must stay inside the project root.
  // The trailing sep check handles the root directory itself.
  const root = __dirname + path.sep;
  if (!filePath.startsWith(root) && filePath !== __dirname) {
    return send(res, 403, 'Forbidden');
  }

  const ext         = path.extname(filePath).toLowerCase();
  const contentType = MIME[ext] ?? 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, 'Not Found');
    res.writeHead(200, { 'Content-Type': contentType, ...SECURITY_HEADERS });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Dev server → http://localhost:${PORT}`);
});
