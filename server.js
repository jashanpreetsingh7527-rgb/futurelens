'use strict';
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

loadEnvFile();

const { supabase } = require('./lib/db');
const A = require('./lib/auth');
const { Router, parseCookies, readBody, json, serveFile } = require('./lib/http');

const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);
const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

const router = new Router();
require('./routes/auth')(router);
require('./routes/admin')(router);
require('./routes/public')(router);

const OPEN_ADMIN_PAGES = new Set(['/admin/login.html', '/admin/set-password.html']);

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  req.clientIp = TRUST_PROXY
    ? (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress
    : req.socket?.remoteAddress;
  req.cookies = parseCookies(req.headers.cookie);
  req.query = url.searchParams;

  securityHeaders(res);

  try {
    // Resolve the session asynchronously
    req.account = await A.currentAccount(req);

    if (pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        assertSameOrigin(req);
        req.body = req.body || await readBody(req);
      } else {
        req.body = req.body || {};
      }
      const match = router.match(req.method, pathname);
      if (!match) return json(res, 404, { error: 'That endpoint does not exist.' });
      req.params = match.params;
      await match.handler(req, res);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return json(res, 405, { error: 'Method not allowed.' });
    }

    // Admin area gate
    if (pathname === '/admin' || pathname === '/admin/') return redirect(res, '/admin/login.html');
    if (pathname.startsWith('/admin/') && pathname.endsWith('.html') && !OPEN_ADMIN_PAGES.has(pathname)) {
      if (!req.account || req.account.account_type !== 'admin' || req.account.status !== 'active') {
        return redirect(res, `/admin/login.html?next=${encodeURIComponent(pathname)}`);
      }
    }
    // An admin already signed in has no reason to see the sign-in screen.
    if (pathname === '/admin/login.html' && req.account?.account_type === 'admin') {
      return redirect(res, '/admin/index.html');
    }

    if (serveFile(res, PUBLIC_DIR, pathname)) return;

    // Content pages fall through to the site shell, which resolves the slug.
    if (!path.extname(pathname) && serveFile(res, PUBLIC_DIR, '/index.html', { cache: 'no-cache' })) return;

    return notFound(res);
  } catch (err) {
    const status = err.statusCode || 500;
    if (status >= 500) console.error(`[${new Date().toISOString()}]`, err);
    if (res.headersSent) return res.end();
    json(res, status, { error: status >= 500 ? 'Something went wrong on the server.' : err.message });
  }
}

const server = http.createServer(handleRequest);

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "img-src 'self' data: blob: https://*.supabase.co",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "script-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
  ].join('; '));
}

function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  const host = req.headers.host;
  try {
    if (new URL(origin).host !== host) {
      throw Object.assign(new Error('Cross-origin request rejected.'), { statusCode: 403 });
    }
  } catch (e) {
    if (e.statusCode) throw e;
    throw Object.assign(new Error('Cross-origin request rejected.'), { statusCode: 403 });
  }
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function loadEnvFile() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i < 0) continue;
    const key = trimmed.slice(0, i).trim();
    let value = trimmed.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  setInterval(() => A.purgeExpiredSessions().catch(() => {}), 30 * 60 * 1000).unref();
}

if (require.main === module) {
  server.listen(PORT, async () => {
    console.log(`FUTURELENS running on http://localhost:${PORT}`);
    try {
      const { count } = await supabase.from('admins').select('*', { count: 'exact', head: true });
      if (count === 0) {
        console.log('No administrator exists yet. Run:  node setup.js');
      }
    } catch (e) {
      // Supabase credentials may not be configured yet
    }
    if (process.env.SECURE_COOKIES !== 'false' && process.env.NODE_ENV !== 'production') {
      console.log('Note: cookies are marked Secure. Over plain http://localhost set SECURE_COOKIES=false in .env');
    }
  });
}

module.exports = { server, handleRequest, router };
