'use strict';
const { supabase, now } = require('../lib/db');
const A = require('../lib/auth');
const { json, fail, setCookie, clearCookie, audit } = require('../lib/http');

const BAD_CREDENTIALS = 'Email or password is incorrect.';

function publicAdmin(a) {
  return {
    id: a.id, full_name: a.full_name, email: a.email, role: a.role,
    status: a.status, photo: a.photo, permissions: A.effectivePermissions(a),
  };
}

function publicMember(m) {
  return {
    id: m.id, full_name: m.full_name, email: m.email, phone: m.phone,
    course: m.course, year_of_study: m.year_of_study, photo: m.photo, status: m.status,
  };
}

module.exports = function register(router) {

  /* ------------------------- admin login ------------------------- */

  router.post('/api/admin/login', async (req, res) => {
    const { email = '', password = '' } = req.body;
    const cleanEmail = String(email).trim().toLowerCase();
    const locked = await A.lockoutRemaining('admin', req, cleanEmail);
    if (locked) {
      throw fail(429, `Too many attempts. Try again in ${locked} minute${locked === 1 ? '' : 's'}.`);
    }

    const { data: admin } = await supabase
      .from('admins')
      .select('*')
      .ilike('email', cleanEmail)
      .maybeSingle();

    const ok = admin && admin.password_hash && A.verifyPassword(password, admin.password_hash);

    if (!ok) {
      await A.recordAttempt('admin', req, cleanEmail, false);
      await supabase.from('audit_log').insert({
        actor_name: String(cleanEmail).slice(0, 120),
        actor_role: 'unknown',
        action: 'login_failed',
        entity: 'admin',
        summary: 'Failed administrator sign-in attempt.',
        ip: req.clientIp || null,
        created_at: now(),
      });
      throw fail(401, BAD_CREDENTIALS);
    }
    if (admin.status === 'disabled') throw fail(403, 'This administrator account is disabled.');
    if (admin.status === 'pending') {
      throw fail(403, 'This account still needs its password set. Use the setup link you were sent.');
    }

    await A.clearAttempts('admin', req, cleanEmail);
    const session = await A.createSession(admin.id, 'admin', req);
    setCookie(res, A.COOKIE_NAME, session.token, { expires: session.expires });
    await supabase.from('admins').update({ last_login_at: now() }).eq('id', admin.id);

    req.account = admin;
    await audit(req, 'login', { entity: 'admin', entityId: admin.id, summary: `${admin.full_name} signed in.` });
    json(res, 200, { account: publicAdmin(admin) });
  });

  /* ------------------------ invite / setup ----------------------- */

  router.get('/api/admin/invite/:token', async (req, res) => {
    const invite = await A.consumeInvite(req.params.token);
    if (!invite) throw fail(400, 'This setup link has expired. Ask a Super Admin for a new one.');
    const { data: admin } = await supabase.from('admins').select('full_name, email').eq('id', invite.admin_id).maybeSingle();
    if (!admin) throw fail(400, 'Administrator not found.');
    json(res, 200, { full_name: admin.full_name, email: admin.email, purpose: invite.purpose });
  });

  router.post('/api/admin/invite/:token', async (req, res) => {
    const invite = await A.consumeInvite(req.params.token);
    if (!invite) throw fail(400, 'This setup link has expired. Ask a Super Admin for a new one.');
    const problem = A.passwordProblem(req.body.password);
    if (problem) throw fail(400, problem);

    await supabase.from('admins').update({
      password_hash: A.hashPassword(req.body.password),
      status: 'active',
    }).eq('id', invite.admin_id);

    await supabase.from('admin_invites').update({ used_at: now() }).eq('token', invite.token);
    await A.destroyAllSessionsFor(invite.admin_id, 'admin');

    const { data: admin } = await supabase.from('admins').select('*').eq('id', invite.admin_id).maybeSingle();
    req.account = admin;
    await audit(req, 'password_set', {
      entity: 'admin', entityId: admin.id,
      summary: `${admin.full_name} set their own password from a setup link.`,
    });
    json(res, 200, { ok: true });
  });

  /* --------------------------- session --------------------------- */

  router.get('/api/session', async (req, res) => {
    if (!req.account) return json(res, 200, { account: null });
    json(res, 200, {
      account: req.account.account_type === 'admin'
        ? { ...publicAdmin(req.account), account_type: 'admin' }
        : { ...publicMember(req.account), account_type: 'member' },
    });
  });

  router.post('/api/logout', async (req, res) => {
    if (req.account) {
      await audit(req, 'logout', {
        entity: req.account.account_type, entityId: req.account.id,
        summary: `${req.account.full_name} signed out.`,
      });
      await A.destroySession(req.account.session_token);
    }
    clearCookie(res, A.COOKIE_NAME);
    json(res, 200, { ok: true });
  });

  router.post('/api/account/password', async (req, res) => {
    if (!req.account) throw fail(401, 'Sign in first.');
    const { current_password = '', new_password = '' } = req.body;
    if (!A.verifyPassword(current_password, req.account.password_hash)) {
      throw fail(400, 'Your current password is incorrect.');
    }
    const problem = A.passwordProblem(new_password);
    if (problem) throw fail(400, problem);

    const table = req.account.account_type === 'admin' ? 'admins' : 'members';
    await supabase.from(table).update({
      password_hash: A.hashPassword(new_password),
    }).eq('id', req.account.id);

    await A.destroyAllSessionsFor(req.account.id, req.account.account_type);
    const session = await A.createSession(req.account.id, req.account.account_type, req);
    setCookie(res, A.COOKIE_NAME, session.token, { expires: session.expires });

    await audit(req, 'password_changed', {
      entity: req.account.account_type, entityId: req.account.id,
      summary: `${req.account.full_name} changed their password.`,
    });
    json(res, 200, { ok: true });
  });

  /* --------------------- member registration --------------------- */

  router.post('/api/register', async (req, res) => {
    const { full_name = '', email = '', password = '', phone = '', course = '', year_of_study = '' } = req.body;

    if (String(full_name).trim().length < 2) throw fail(400, 'Enter your full name.');
    const cleanEmail = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw fail(400, 'Enter a valid email address.');
    const problem = A.passwordProblem(password);
    if (problem) throw fail(400, problem);

    const { data: memberExists } = await supabase.from('members').select('id').ilike('email', cleanEmail).maybeSingle();
    if (memberExists) throw fail(409, 'An account with that email already exists.');

    const { data: adminExists } = await supabase.from('admins').select('id').ilike('email', cleanEmail).maybeSingle();
    if (adminExists) throw fail(409, 'An account with that email already exists.');

    const { data: newMember, error } = await supabase.from('members').insert({
      full_name: String(full_name).trim(),
      email: cleanEmail,
      password_hash: A.hashPassword(password),
      phone: String(phone).trim() || null,
      course: String(course).trim() || null,
      year_of_study: String(year_of_study).trim() || null,
      status: 'pending',
      created_at: now(),
    }).select().single();

    if (error) throw fail(500, error.message);

    await supabase.from('audit_log').insert({
      actor_name: String(full_name).trim(),
      actor_role: 'member',
      action: 'member_registered',
      entity: 'member',
      entity_id: String(newMember.id),
      summary: `${full_name} registered as a member.`,
      ip: req.clientIp || null,
      created_at: now(),
    });

    json(res, 201, { ok: true, status: 'pending' });
  });

  router.post('/api/login', async (req, res) => {
    const { email = '', password = '' } = req.body;
    const cleanEmail = String(email).trim().toLowerCase();
    const locked = await A.lockoutRemaining('member', req, cleanEmail);
    if (locked) throw fail(429, `Too many attempts. Try again in ${locked} minute${locked === 1 ? '' : 's'}.`);

    const { data: member } = await supabase.from('members').select('*').ilike('email', cleanEmail).maybeSingle();
    if (!member || !A.verifyPassword(password, member.password_hash)) {
      await A.recordAttempt('member', req, cleanEmail, false);
      throw fail(401, BAD_CREDENTIALS);
    }
    if (member.status === 'suspended') throw fail(403, 'This account is suspended. Contact the club committee.');

    await A.clearAttempts('member', req, cleanEmail);
    const session = await A.createSession(member.id, 'member', req);
    setCookie(res, A.COOKIE_NAME, session.token, { expires: session.expires });
    json(res, 200, { account: { ...publicMember(member), account_type: 'member' } });
  });

  return { publicAdmin, publicMember };
};
