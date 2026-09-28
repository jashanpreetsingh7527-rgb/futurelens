'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { supabase, now } = require('./db');

/* ------------------------------ routing ---------------------------- */

class Router {
  constructor() { this.routes = []; }
  add(method, pattern, handler) {
    const keys = [];
    const regex = new RegExp('^' + pattern.replace(/:[A-Za-z_]+/g, (m) => {
      keys.push(m.slice(1));
      return '([^/]+)';
    }) + '$');
    this.routes.push({ method, regex, keys, handler });
    return this;
  }
  get(p, h) { return this.add('GET', p, h); }
  post(p, h) { return this.add('POST', p, h); }
  put(p, h) { return this.add('PUT', p, h); }
  patch(p, h) { return this.add('PATCH', p, h); }
  delete(p, h) { return this.add('DELETE', p, h); }

  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = route.regex.exec(pathname);
      if (!m) continue;
      const params = {};
      route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { handler: route.handler, params };
    }
    return null;
  }
}

/* --------------------------- request/response ---------------------- */

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const MAX_BODY = 8 * 1024 * 1024; // 8 MB

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('That file is too large. Keep uploads under 6 MB.'),
          { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch { reject(Object.assign(new Error('Malformed request.'), { statusCode: 400 })); }
    });
    req.on('error', reject);
  });
}

function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

function fail(status, message, extra = {}) {
  return Object.assign(new Error(message), { statusCode: status, extra });
}

function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.expires) parts.push(`Expires=${new Date(opts.expires).toUTCString()}`);
  if (process.env.SECURE_COOKIES !== 'false') parts.push('Secure');
  const existing = res.getHeader('Set-Cookie');
  const cookie = parts.join('; ');
  res.setHeader('Set-Cookie', existing ? [].concat(existing, cookie) : cookie);
}

function clearCookie(res, name) {
  setCookie(res, name, '', { maxAge: 0 });
}

/* ------------------------------ uploads ---------------------------- */

const ALLOWED_IMAGE = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
};

async function saveDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') throw fail(400, 'That image could not be read.');
  if (!dataUrl.startsWith('data:')) return dataUrl; // already a stored path or URL
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl);
  if (!m) throw fail(400, 'That image could not be read.');
  const mime = m[1].toLowerCase();
  const ext = ALLOWED_IMAGE[mime];
  if (!ext) throw fail(400, 'Images must be JPG, PNG, WebP or GIF.');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 6 * 1024 * 1024) throw fail(413, 'Keep images under 6 MB.');
  if (!sniffLooksLikeImage(buf)) throw fail(400, 'That file is not an image.');
  
  const name = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${ext}`;

  // Upload to Supabase Storage bucket 'uploads'
  const { error: uploadError } = await supabase.storage
    .from('uploads')
    .upload(name, buf, {
      contentType: mime,
      upsert: true,
    });

  if (uploadError) {
    console.error('Supabase storage upload error:', uploadError);
    throw fail(500, 'Failed to upload image to cloud storage: ' + uploadError.message);
  }

  const { data: { publicUrl } } = supabase.storage.from('uploads').getPublicUrl(name);
  return publicUrl;
}

function sniffLooksLikeImage(buf) {
  if (buf.length < 12) return false;
  const hex = buf.subarray(0, 12).toString('hex');
  return hex.startsWith('ffd8ff')                       // jpeg
    || hex.startsWith('89504e470d0a1a0a')               // png
    || hex.startsWith('47494638')                       // gif
    || (hex.startsWith('52494646') && buf.subarray(8, 12).toString() === 'WEBP');
}

/* ----------------------------- static files ------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function serveFile(res, root, relPath, { cache = 'public, max-age=300' } = {}) {
  const resolved = path.resolve(root, '.' + path.posix.normalize('/' + relPath));
  if (!resolved.startsWith(path.resolve(root))) return false;   // traversal guard
  let stat;
  try { stat = fs.statSync(resolved); } catch { return false; }
  if (stat.isDirectory()) return serveFile(res, root, path.posix.join(relPath, 'index.html'), { cache });
  const ext = path.extname(resolved).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': cache,
  });
  fs.createReadStream(resolved).pipe(res);
  return true;
}

/* ------------------------------- audit ----------------------------- */

async function audit(req, action, { entity = null, entityId = null, summary }) {
  const actor = req.account;
  try {
    await supabase.from('audit_log').insert({
      actor_id: actor ? actor.id : null,
      actor_name: actor ? actor.full_name : 'system',
      actor_role: actor ? (actor.role || actor.account_type) : 'system',
      action,
      entity,
      entity_id: entityId == null ? null : String(entityId),
      summary,
      ip: req.clientIp || null,
      created_at: now(),
    });
  } catch (err) {
    console.error('Audit log failed:', err.message);
  }
}

module.exports = {
  Router, parseCookies, readBody, json, fail, setCookie, clearCookie,
  saveDataUrl, serveFile, audit,
};
