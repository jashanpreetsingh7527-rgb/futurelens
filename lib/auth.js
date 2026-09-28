'use strict';
const crypto = require('node:crypto');
const { supabase, now, SUPER_ONLY_PERMISSIONS, DEFAULT_ADMIN_PERMISSIONS } = require('./db');

const SESSION_HOURS = Number(process.env.SESSION_HOURS || 8);
const MAX_ATTEMPTS = Number(process.env.LOGIN_MAX_ATTEMPTS || 5);
const LOCKOUT_MINUTES = Number(process.env.LOGIN_LOCKOUT_MINUTES || 15);

/* ---------------------------- passwords ---------------------------- */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, SCRYPT.keylen, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

function verifyPassword(password, stored) {
  if (!stored) return false;
  try {
    const [scheme, N, r, p, saltB64, keyB64] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(keyB64, 'base64');
    const actual = crypto.scryptSync(password, salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p),
    });
    return crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 10) {
    return 'Password must be at least 10 characters.';
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password needs an uppercase letter, a lowercase letter and a number.';
  }
  return null;
}

/* ---------------------------- sessions ----------------------------- */

async function createSession(accountId, accountType, req) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
  await supabase.from('sessions').insert({
    token,
    account_id: accountId,
    account_type: accountType,
    created_at: now(),
    expires_at: expires,
    ip: req.clientIp || null,
    user_agent: (req.headers['user-agent'] || '').slice(0, 250),
  });
  return { token, expires };
}

async function destroySession(token) {
  if (token) await supabase.from('sessions').delete().eq('token', token);
}

async function destroyAllSessionsFor(accountId, accountType) {
  await supabase.from('sessions').delete().eq('account_id', accountId).eq('account_type', accountType);
}

async function purgeExpiredSessions() {
  await supabase.from('sessions').delete().lt('expires_at', now());
}

async function currentAccount(req) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return null;
  const { data: session } = await supabase.from('sessions').select('*').eq('token', token).maybeSingle();
  if (!session) return null;
  if (session.expires_at < now()) {
    await destroySession(token);
    return null;
  }
  const table = session.account_type === 'admin' ? 'admins' : 'members';
  const { data: account } = await supabase.from(table).select('*').eq('id', session.account_id).maybeSingle();
  if (!account || account.status !== (session.account_type === 'admin' ? 'active' : account.status)) {
    if (session.account_type === 'admin') {
      await destroySession(token);
      return null;
    }
  }
  if (!account) {
    await destroySession(token);
    return null;
  }
  account.account_type = session.account_type;
  account.session_token = token;
  if (session.account_type === 'admin') {
    account.permissions = effectivePermissions(account);
  }
  return account;
}

const COOKIE_NAME = 'fl_session';

/* --------------------------- permissions --------------------------- */

function effectivePermissions(admin) {
  if (admin.role === 'super_admin') return ['*'];
  let list = [];
  try {
    list = typeof admin.permissions === 'string' ? JSON.parse(admin.permissions || '[]') : (admin.permissions || []);
  } catch {
    list = [];
  }
  return list.filter((p) => !SUPER_ONLY_PERMISSIONS.has(p));
}

function can(account, permission) {
  if (!account || account.account_type !== 'admin') return false;
  if (account.status !== 'active') return false;
  if (account.role === 'super_admin') return true;
  if (SUPER_ONLY_PERMISSIONS.has(permission)) return false;
  return (account.permissions || []).includes(permission);
}

function sanitisePermissions(role, requested) {
  if (role === 'super_admin') return [];
  const set = new Set(Array.isArray(requested) ? requested : DEFAULT_ADMIN_PERMISSIONS);
  for (const p of SUPER_ONLY_PERMISSIONS) set.delete(p);
  return [...set];
}

/* -------------------------- rate limiting -------------------------- */

function attemptKey(req, identifier) {
  return `${req.clientIp || 'unknown'}|${(identifier || '').toLowerCase()}`;
}

async function recordAttempt(scope, req, identifier, ok) {
  await supabase.from('login_attempts').insert({
    scope,
    identifier: attemptKey(req, identifier),
    attempted_at: now(),
    ok: ok ? 1 : 0,
  });
}

async function lockoutRemaining(scope, req, identifier) {
  const since = new Date(Date.now() - LOCKOUT_MINUTES * 60 * 1000).toISOString();
  const { data: rows } = await supabase
    .from('login_attempts')
    .select('attempted_at, ok')
    .eq('scope', scope)
    .eq('identifier', attemptKey(req, identifier))
    .gt('attempted_at', since)
    .order('attempted_at', { ascending: false });

  if (!rows || rows.length === 0) return 0;
  let failures = 0;
  for (const row of rows) {
    if (row.ok) break;
    failures += 1;
  }
  if (failures < MAX_ATTEMPTS) return 0;
  const oldest = rows[Math.min(failures, rows.length) - 1].attempted_at;
  const until = new Date(oldest).getTime() + LOCKOUT_MINUTES * 60 * 1000;
  return Math.max(0, Math.ceil((until - Date.now()) / 60000));
}

async function clearAttempts(scope, req, identifier) {
  await supabase
    .from('login_attempts')
    .delete()
    .eq('scope', scope)
    .eq('identifier', attemptKey(req, identifier));
}

/* ------------------------------ invites ---------------------------- */

async function createInvite(adminId, purpose = 'setup', hours = 48) {
  const token = crypto.randomBytes(32).toString('base64url');
  await supabase.from('admin_invites').delete().eq('admin_id', adminId).is('used_at', null);
  await supabase.from('admin_invites').insert({
    token,
    admin_id: adminId,
    purpose,
    expires_at: new Date(Date.now() + hours * 3600 * 1000).toISOString(),
  });
  return token;
}

async function consumeInvite(token) {
  const { data: invite } = await supabase.from('admin_invites').select('*').eq('token', token).maybeSingle();
  if (!invite || invite.used_at || invite.expires_at < now()) return null;
  return invite;
}

module.exports = {
  COOKIE_NAME, SESSION_HOURS, MAX_ATTEMPTS, LOCKOUT_MINUTES,
  hashPassword, verifyPassword, passwordProblem,
  createSession, destroySession, destroyAllSessionsFor, purgeExpiredSessions, currentAccount,
  effectivePermissions, can, sanitisePermissions,
  recordAttempt, lockoutRemaining, clearAttempts,
  createInvite, consumeInvite,
};
