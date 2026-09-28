'use strict';
const { supabase, now, PERMISSIONS, RESOURCES, SUPER_ONLY_PERMISSIONS } = require('../lib/db');
const A = require('../lib/auth');
const { json, fail, audit, saveDataUrl } = require('../lib/http');

/* ------------------------------ guards ----------------------------- */

function requireAdmin(req) {
  if (!req.account || req.account.account_type !== 'admin') {
    throw fail(401, 'Sign in to the admin area to continue.');
  }
  if (req.account.status !== 'active') throw fail(403, 'This administrator account is not active.');
  return req.account;
}

function requireSuperAdmin(req) {
  const admin = requireAdmin(req);
  if (admin.role !== 'super_admin') throw fail(403, 'Only a Super Admin can do that.');
  return admin;
}

function requirePermission(req, permission) {
  const admin = requireAdmin(req);
  if (!A.can(admin, permission)) throw fail(403, 'You do not have permission to do that.');
  return admin;
}

function publicAdmin(a) {
  return {
    id: a.id, full_name: a.full_name, email: a.email, role: a.role, status: a.status,
    photo: a.photo, permissions: A.effectivePermissions(a),
    created_at: a.created_at, last_login_at: a.last_login_at,
  };
}

async function countActiveSuperAdmins(excludingId) {
  let query = supabase
    .from('admins')
    .select('*', { count: 'exact', head: true })
    .eq('role', 'super_admin')
    .eq('status', 'active');
  if (excludingId) {
    query = query.neq('id', excludingId);
  }
  const { count } = await query;
  return count || 0;
}

/* ------------------------- field coercion -------------------------- */

async function coerceValue(field, raw) {
  if (raw === undefined) return undefined;
  switch (field.type) {
    case 'number': {
      if (raw === '' || raw === null) return field.default ?? 0;
      const n = Number(raw);
      if (!Number.isFinite(n)) throw fail(400, `${field.label} must be a number.`);
      return Math.trunc(n);
    }
    case 'boolean':
      return raw === true || raw === 1 || raw === '1' || raw === 'true' ? 1 : 0;
    case 'image':
      if (!raw) return null;
      return await saveDataUrl(raw);
    case 'date':
      if (!raw) return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) throw fail(400, `${field.label} must be a date.`);
      return String(raw);
    case 'select':
      if (!raw) return field.default ?? field.options[0];
      if (!field.options.includes(String(raw))) throw fail(400, `${field.label} is not a valid choice.`);
      return String(raw);
    default: {
      const v = raw === null ? null : String(raw).trim();
      return v === '' ? null : v;
    }
  }
}

async function buildRow(res, body, { partial = false } = {}) {
  const row = {};
  for (const field of res.fields) {
    const raw = body[field.name];
    if (partial && raw === undefined) continue;
    const value = await coerceValue(field, raw);
    if (field.required && (value === null || value === undefined || value === '')) {
      if (!partial) throw fail(400, `${field.label} is required.`);
    }
    row[field.name] = value === undefined ? (field.default ?? null) : value;
  }
  return row;
}

function article(word) {
  return /^[aeiou]/i.test(String(word)) ? 'an' : 'a';
}

function titleOf(resourceName, row) {
  return row.title || row.name || row.label || row.caption || row.slug || `#${row.id}`;
}

/* ------------------------------ routes ----------------------------- */

module.exports = function register(router) {

  /* --- what the signed-in admin is allowed to see and do --- */
  router.get('/api/admin/bootstrap', async (req, res) => {
    const admin = requireAdmin(req);
    const sections = Object.entries(RESOURCES)
      .filter(([, r]) => A.can(admin, r.permission))
      .map(([key, r]) => ({
        key, label: r.label, singular: r.singular, permission: r.permission, fields: r.fields,
      }));
    json(res, 200, {
      account: publicAdmin(admin),
      sections,
      permissions: PERMISSIONS,
      can: {
        members: A.can(admin, 'manage_members'),
        administrators: admin.role === 'super_admin',
        settings: admin.role === 'super_admin',
        audit: admin.role === 'super_admin',
      },
    });
  });

  /* ---------------------- administrators ----------------------- */

  router.get('/api/admin/administrators', async (req, res) => {
    requireSuperAdmin(req);
    const { data: rows, error } = await supabase
      .from('admins')
      .select('*')
      .order('role', { ascending: false })
      .order('full_name', { ascending: true });
    if (error) throw fail(500, error.message);
    json(res, 200, { administrators: (rows || []).map(publicAdmin), permissions: PERMISSIONS });
  });

  router.post('/api/admin/administrators', async (req, res) => {
    const actor = requireSuperAdmin(req);
    const { full_name = '', email = '', role = 'admin', permissions, photo, password } = req.body;

    if (String(full_name).trim().length < 2) throw fail(400, 'Enter the administrator’s full name.');
    const cleanEmail = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) throw fail(400, 'Enter a valid email address.');
    if (!['admin', 'super_admin'].includes(role)) throw fail(400, 'Choose a valid role.');

    const { data: adminExists } = await supabase.from('admins').select('id').ilike('email', cleanEmail).maybeSingle();
    const { data: memberExists } = await supabase.from('members').select('id').ilike('email', cleanEmail).maybeSingle();
    if (adminExists || memberExists) {
      throw fail(409, 'An account with that email already exists.');
    }

    let hash = null;
    let status = 'pending';
    if (password) {
      const problem = A.passwordProblem(password);
      if (problem) throw fail(400, problem);
      hash = A.hashPassword(password);
      status = 'active';
    }

    const perms = A.sanitisePermissions(role, permissions);
    const uploadedPhoto = photo ? await saveDataUrl(photo) : null;

    const { data: newAdmin, error } = await supabase.from('admins').insert({
      full_name: String(full_name).trim(),
      email: cleanEmail,
      password_hash: hash,
      role,
      status,
      permissions: JSON.stringify(perms),
      photo: uploadedPhoto,
      created_at: now(),
      created_by: actor.id,
    }).select().single();

    if (error) throw fail(500, error.message);

    const inviteToken = hash ? null : await A.createInvite(newAdmin.id, 'setup');

    await audit(req, 'admin_created', {
      entity: 'admin', entityId: newAdmin.id,
      summary: `${actor.full_name} created a new ${role === 'super_admin' ? 'Super Admin' : 'administrator'}: ${full_name}.`,
    });

    json(res, 201, {
      administrator: publicAdmin(newAdmin),
      setup_link: inviteToken ? `/admin/set-password.html?token=${inviteToken}` : null,
    });
  });

  router.patch('/api/admin/administrators/:id', async (req, res) => {
    const actor = requireSuperAdmin(req);
    const id = Number(req.params.id);
    const { data: target } = await supabase.from('admins').select('*').eq('id', id).maybeSingle();
    if (!target) throw fail(404, 'That administrator no longer exists.');

    const changes = [];
    const set = {};

    if (req.body.full_name !== undefined) {
      if (String(req.body.full_name).trim().length < 2) throw fail(400, 'Enter a full name.');
      set.full_name = String(req.body.full_name).trim();
      if (set.full_name !== target.full_name) changes.push('name');
    }

    if (req.body.role !== undefined && req.body.role !== target.role) {
      if (!['admin', 'super_admin'].includes(req.body.role)) throw fail(400, 'Choose a valid role.');
      if (target.id === actor.id) throw fail(403, 'You cannot change your own role.');
      if (target.role === 'super_admin' && (await countActiveSuperAdmins(target.id)) === 0) {
        throw fail(409, 'This is the last active Super Admin. Promote someone else first.');
      }
      set.role = req.body.role;
      changes.push(`role to ${req.body.role === 'super_admin' ? 'Super Admin' : 'Admin'}`);
    }

    if (req.body.status !== undefined && req.body.status !== target.status) {
      if (!['active', 'disabled'].includes(req.body.status)) throw fail(400, 'Choose a valid status.');
      if (target.id === actor.id) throw fail(403, 'You cannot disable your own account.');
      if (target.role === 'super_admin' && req.body.status === 'disabled'
        && (await countActiveSuperAdmins(target.id)) === 0) {
        throw fail(409, 'This is the last active Super Admin and cannot be disabled.');
      }
      set.status = req.body.status;
      changes.push(req.body.status === 'disabled' ? 'disabled the account' : 'enabled the account');
    }

    if (req.body.permissions !== undefined) {
      const role = set.role || target.role;
      set.permissions = JSON.stringify(A.sanitisePermissions(role, req.body.permissions));
      changes.push('permissions');
    }

    if (req.body.photo !== undefined) {
      set.photo = req.body.photo ? await saveDataUrl(req.body.photo) : null;
    }

    if (Object.keys(set).length) {
      await supabase.from('admins').update(set).eq('id', id);
    }
    if (set.status === 'disabled' || set.role || set.permissions) {
      await A.destroyAllSessionsFor(id, 'admin');
    }

    await audit(req, 'admin_updated', {
      entity: 'admin', entityId: id,
      summary: `${actor.full_name} updated ${target.full_name}${changes.length ? ` (${changes.join(', ')})` : ''}.`,
    });

    const { data: updated } = await supabase.from('admins').select('*').eq('id', id).single();
    json(res, 200, { administrator: publicAdmin(updated) });
  });

  router.post('/api/admin/administrators/:id/reset', async (req, res) => {
    const actor = requireSuperAdmin(req);
    const id = Number(req.params.id);
    const { data: target } = await supabase.from('admins').select('*').eq('id', id).maybeSingle();
    if (!target) throw fail(404, 'That administrator no longer exists.');

    await supabase.from('admins').update({ password_hash: null, status: 'pending' }).eq('id', id);
    await A.destroyAllSessionsFor(id, 'admin');
    const token = await A.createInvite(id, 'reset');

    await audit(req, 'admin_access_reset', {
      entity: 'admin', entityId: id,
      summary: `${actor.full_name} reset access for ${target.full_name}.`,
    });
    json(res, 200, { setup_link: `/admin/set-password.html?token=${token}` });
  });

  router.delete('/api/admin/administrators/:id', async (req, res) => {
    const actor = requireSuperAdmin(req);
    const id = Number(req.params.id);
    const { data: target } = await supabase.from('admins').select('*').eq('id', id).maybeSingle();
    if (!target) throw fail(404, 'That administrator no longer exists.');
    if (target.id === actor.id) throw fail(403, 'You cannot remove your own account.');
    if (target.role === 'super_admin' && (await countActiveSuperAdmins(target.id)) === 0) {
      throw fail(409, 'This is the last active Super Admin and cannot be removed.');
    }

    await A.destroyAllSessionsFor(id, 'admin');
    await supabase.from('admins').delete().eq('id', id);
    await audit(req, 'admin_removed', {
      entity: 'admin', entityId: id,
      summary: `${actor.full_name} removed administrator ${target.full_name}.`,
    });
    json(res, 200, { ok: true });
  });

  /* --------------------------- members -------------------------- */

  router.get('/api/admin/members', async (req, res) => {
    requirePermission(req, 'manage_members');
    const { data: rows, error } = await supabase
      .from('members')
      .select('id, full_name, email, phone, course, year_of_study, photo, status, created_at')
      .order('created_at', { ascending: false });
    if (error) throw fail(500, error.message);
    json(res, 200, { members: rows || [] });
  });

  router.patch('/api/admin/members/:id', async (req, res) => {
    const actor = requirePermission(req, 'manage_members');
    const id = Number(req.params.id);
    const { data: member } = await supabase.from('members').select('*').eq('id', id).maybeSingle();
    if (!member) throw fail(404, 'That member no longer exists.');

    const set = {};
    for (const key of ['full_name', 'phone', 'course', 'year_of_study']) {
      if (req.body[key] !== undefined) set[key] = String(req.body[key]).trim() || null;
    }
    if (req.body.status !== undefined) {
      if (!['pending', 'approved', 'suspended'].includes(req.body.status)) {
        throw fail(400, 'Choose a valid status.');
      }
      set.status = req.body.status;
    }

    if (Object.keys(set).length) {
      await supabase.from('members').update(set).eq('id', id);
    }
    if (set.status === 'suspended') await A.destroyAllSessionsFor(id, 'member');

    await audit(req, 'member_updated', {
      entity: 'member', entityId: id,
      summary: `${actor.full_name} updated member ${member.full_name}${set.status ? ` (${set.status})` : ''}.`,
    });
    json(res, 200, { ok: true });
  });

  router.delete('/api/admin/members/:id', async (req, res) => {
    const actor = requirePermission(req, 'manage_members');
    const id = Number(req.params.id);
    const { data: member } = await supabase.from('members').select('*').eq('id', id).maybeSingle();
    if (!member) throw fail(404, 'That member no longer exists.');
    await A.destroyAllSessionsFor(id, 'member');
    await supabase.from('members').delete().eq('id', id);
    await audit(req, 'member_removed', {
      entity: 'member', entityId: id,
      summary: `${actor.full_name} removed member ${member.full_name}.`,
    });
    json(res, 200, { ok: true });
  });

  /* ------------------------ content CRUD ------------------------ */

  router.get('/api/admin/content/:resource', async (req, res) => {
    const resource = RESOURCES[req.params.resource];
    if (!resource) throw fail(404, 'Unknown section.');
    requirePermission(req, resource.permission);

    let query = supabase.from(`content_${req.params.resource}`).select('*');
    if (resource.orderBy) {
      query = query.order(resource.orderBy.column, { ascending: resource.orderBy.ascending });
    }
    if (resource.secondaryOrderBy) {
      query = query.order(resource.secondaryOrderBy.column, { ascending: resource.secondaryOrderBy.ascending });
    }
    const { data: rows, error } = await query;
    if (error) throw fail(500, error.message);
    json(res, 200, { items: rows || [], fields: resource.fields, label: resource.label });
  });

  router.post('/api/admin/content/:resource', async (req, res) => {
    const name = req.params.resource;
    const resource = RESOURCES[name];
    if (!resource) throw fail(404, 'Unknown section.');
    const actor = requirePermission(req, resource.permission);

    const row = await buildRow(resource, req.body);
    row.created_at = now();
    row.updated_at = now();
    row.updated_by = actor.id;

    const { data: newItem, error } = await supabase.from(`content_${name}`).insert(row).select().single();
    if (error) throw fail(500, error.message);

    await audit(req, 'content_created', {
      entity: name, entityId: newItem.id,
      summary: `${actor.full_name} added ${article(resource.singular)} ${resource.singular}: ${titleOf(name, row)}.`,
    });
    json(res, 201, { item: newItem });
  });

  router.patch('/api/admin/content/:resource/:id', async (req, res) => {
    const name = req.params.resource;
    const resource = RESOURCES[name];
    if (!resource) throw fail(404, 'Unknown section.');
    const actor = requirePermission(req, resource.permission);
    const id = Number(req.params.id);

    const { data: existing } = await supabase.from(`content_${name}`).select('*').eq('id', id).maybeSingle();
    if (!existing) throw fail(404, `That ${resource.singular} no longer exists.`);

    const row = await buildRow(resource, req.body, { partial: true });
    row.updated_at = now();
    row.updated_by = actor.id;

    const { data: updatedItem, error } = await supabase
      .from(`content_${name}`)
      .update(row)
      .eq('id', id)
      .select()
      .single();

    if (error) throw fail(500, error.message);

    await audit(req, 'content_updated', {
      entity: name, entityId: id,
      summary: `${actor.full_name} updated ${article(resource.singular)} ${resource.singular}: ${titleOf(name, { ...existing, ...row })}.`,
    });
    json(res, 200, { item: updatedItem });
  });

  router.delete('/api/admin/content/:resource/:id', async (req, res) => {
    const name = req.params.resource;
    const resource = RESOURCES[name];
    if (!resource) throw fail(404, 'Unknown section.');
    const actor = requirePermission(req, resource.permission);
    const id = Number(req.params.id);

    const { data: existing } = await supabase.from(`content_${name}`).select('*').eq('id', id).maybeSingle();
    if (!existing) throw fail(404, `That ${resource.singular} no longer exists.`);

    await supabase.from(`content_${name}`).delete().eq('id', id);
    await audit(req, 'content_deleted', {
      entity: name, entityId: id,
      summary: `${actor.full_name} deleted ${article(resource.singular)} ${resource.singular}: ${titleOf(name, existing)}.`,
    });
    json(res, 200, { ok: true });
  });

  /* --------------------------- settings ------------------------- */

  router.get('/api/admin/settings', async (req, res) => {
    requireSuperAdmin(req);
    const { data: rows } = await supabase.from('settings').select('key, value');
    json(res, 200, { settings: Object.fromEntries((rows || []).map((r) => [r.key, r.value])) });
  });

  router.put('/api/admin/settings', async (req, res) => {
    const actor = requireSuperAdmin(req);
    const allowed = ['site_title', 'tagline', 'about', 'contact_email', 'contact_phone',
      'address', 'instagram', 'linkedin', 'youtube', 'join_open'];
    const changed = [];
    for (const key of allowed) {
      if (req.body[key] === undefined) continue;
      await supabase.from('settings').upsert({
        key,
        value: String(req.body[key]),
        updated_at: now(),
      });
      changed.push(key);
    }
    await audit(req, 'settings_updated', {
      entity: 'settings',
      summary: `${actor.full_name} updated website settings (${changed.join(', ') || 'no change'}).`,
    });
    json(res, 200, { ok: true });
  });

  /* -------------------------- audit log ------------------------- */

  router.get('/api/admin/audit', async (req, res) => {
    requireSuperAdmin(req);
    const limit = Math.min(Number(req.query.get('limit') || 100), 500);
    const before = req.query.get('before');

    let query = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(limit);
    if (before) {
      query = query.lt('created_at', before);
    }
    const { data: rows, error } = await query;
    if (error) throw fail(500, error.message);
    json(res, 200, { entries: rows || [] });
  });

  return { requireAdmin, requireSuperAdmin, requirePermission };
};
