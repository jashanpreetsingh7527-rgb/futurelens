'use strict';

const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function when(iso, withTime = true) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    + (withTime ? ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401 && !location.pathname.endsWith('login.html')) {
    location.href = '/admin/login.html?next=' + encodeURIComponent(location.pathname + location.search);
    throw new Error('Session ended.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
  return data;
}

function notice(target, kind, html) {
  const el = typeof target === 'string' ? $(target) : target;
  if (el) el.innerHTML = `<div class="notice ${kind}">${html}</div>`;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('That image could not be read.'));
    reader.readAsDataURL(file);
  });
}

/* ================================ SIGN IN =========================== */

function pageLogin() {
  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('loginBtn');
    btn.disabled = true;
    $('loginNotice').innerHTML = '';
    try {
      await api('/api/admin/login', {
        method: 'POST',
        body: { email: $('email').value, password: $('password').value },
      });
      const next = qs.get('next');
      location.href = next && next.startsWith('/admin/') ? next : '/admin/index.html';
    } catch (err) {
      notice('loginNotice', 'error', esc(err.message));
      btn.disabled = false;
    }
  });
}

function pageSetPassword() {
  const token = qs.get('token');
  const form = $('setForm');
  if (!token) {
    form.hidden = true;
    return notice('setNotice', 'error', 'This link is missing its token. Ask a Super Admin for a new one.');
  }
  api(`/api/admin/invite/${encodeURIComponent(token)}`)
    .then((data) => {
      $('who').textContent = `${data.full_name} — ${data.email}`;
      form.hidden = false;
    })
    .catch((err) => {
      form.hidden = true;
      notice('setNotice', 'error', esc(err.message));
    });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    $('setNotice').innerHTML = '';
    if ($('password').value !== $('confirm').value) {
      return notice('setNotice', 'error', 'The two passwords do not match.');
    }
    try {
      await api(`/api/admin/invite/${encodeURIComponent(token)}`, {
        method: 'POST', body: { password: $('password').value },
      });
      form.hidden = true;
      notice('setNotice', 'ok', 'Password set. <a href="/admin/login.html">Sign in</a>.');
    } catch (err) {
      notice('setNotice', 'error', esc(err.message));
    }
  });
}

/* ================================ SHELL ============================= */

let BOOT = null;

const NAV_STATIC = [
  { href: '/admin/index.html', label: 'Overview', always: true },
  { href: '/admin/members.html', label: 'Members', flag: 'members' },
];

async function buildShell(activeHref) {
  BOOT = await api('/api/admin/bootstrap');
  const a = BOOT.account;

  const links = [];
  links.push(navLink('/admin/index.html', 'Overview', activeHref));
  if (BOOT.can.members) links.push(navLink('/admin/members.html', 'Members', activeHref));

  if (BOOT.sections.length) {
    links.push('<div class="group">CONTENT</div>');
    for (const s of BOOT.sections) {
      const href = `/admin/content.html?section=${s.key}`;
      links.push(navLink(href, s.label, activeHref, qs.get('section') === s.key));
    }
  }
  if (BOOT.can.administrators || BOOT.can.settings || BOOT.can.audit) {
    links.push('<div class="group">ADMINISTRATION</div>');
    if (BOOT.can.administrators) links.push(navLink('/admin/administrators.html', 'Administrators', activeHref));
    if (BOOT.can.settings) links.push(navLink('/admin/settings.html', 'Website settings', activeHref));
    if (BOOT.can.audit) links.push(navLink('/admin/audit.html', 'Activity log', activeHref));
  }
  links.push('<div class="group">&nbsp;</div>');
  links.push(navLink('/', 'View the website', ''));

  $('side').innerHTML = `
    <div class="crest">
      <img src="/assets/img/logo-light.png" alt="">
      <span class="words"><b>FUTURELENS</b><span class="slogan">SEE THE FUTURE! SHAPE THE FUTURE!</span></span>
    </div>
    <nav>${links.join('')}</nav>
    <div class="who">
      <b>${esc(a.full_name)}</b>
      <span>${a.role === 'super_admin' ? 'Super Admin' : 'Admin'}</span>
      <button id="signOut">Sign out</button>
    </div>`;

  $('signOut').addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    location.href = '/admin/login.html';
  });

  const toggle = $('sideToggle');
  if (toggle) toggle.addEventListener('click', () => $('side').classList.toggle('open'));
  return BOOT;
}

function navLink(href, label, active, forceActive = false) {
  const isActive = forceActive || (href === active && !qs.get('section'));
  return `<a href="${href}" class="${isActive ? 'active' : ''}">${esc(label)}</a>`;
}

/* ------------------------------- drawer ---------------------------- */

function openDrawer(title, bodyHtml, { saveLabel = 'Save', onSave }) {
  $('drawerTitle').textContent = title;
  $('drawerBody').innerHTML = bodyHtml;
  $('drawerSave').textContent = saveLabel;
  $('drawer').classList.add('open');
  $('scrim').classList.add('open');
  $('drawerSave').onclick = async () => {
    $('drawerSave').disabled = true;
    try { await onSave(); } catch (err) { notice('drawerNotice', 'error', esc(err.message)); }
    $('drawerSave').disabled = false;
  };
  const first = $('drawerBody').querySelector('input, select, textarea');
  if (first) first.focus();
}

function closeDrawer() {
  $('drawer').classList.remove('open');
  $('scrim').classList.remove('open');
}

function wireDrawer() {
  $('scrim').addEventListener('click', closeDrawer);
  $('drawerClose').addEventListener('click', closeDrawer);
  $('drawerCancel').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
}

/* =============================== OVERVIEW =========================== */

async function pageDashboard() {
  await buildShell('/admin/index.html');
  const a = BOOT.account;
  $('greeting').textContent = `Signed in as ${a.full_name}`;

  const counts = await Promise.all(BOOT.sections.map(async (s) => {
    const { items } = await api(`/api/admin/content/${s.key}`);
    return { label: s.label, key: s.key, n: items.length };
  }));

  let memberTile = '';
  if (BOOT.can.members) {
    const { members } = await api('/api/admin/members');
    const pending = members.filter((m) => m.status === 'pending').length;
    memberTile = `<a class="tile" href="/admin/members.html">
        <b>${members.length}</b><span>Members${pending ? ` &middot; ${pending} awaiting approval` : ''}</span>
      </a>`;
  }

  $('tiles').innerHTML = memberTile + counts.map((c) =>
    `<a class="tile" href="/admin/content.html?section=${c.key}"><b>${c.n}</b><span>${esc(c.label)}</span></a>`
  ).join('');

  if (!BOOT.can.audit) return void ($('recent').closest('section').hidden = true);
  const { entries } = await api('/api/admin/audit?limit=12');
  $('recent').innerHTML = entries.length
    ? entries.map((e) => `<li>
        <span>${esc(e.summary)}<br><span class="actor">${esc(e.actor_name || 'system')}</span></span>
        <span class="when">${esc(when(e.created_at))}</span></li>`).join('')
    : '<li class="empty">Nothing has happened yet.</li>';
}

/* ============================ ADMINISTRATORS ======================== */

async function pageAdministrators() {
  await buildShell('/admin/administrators.html');
  wireDrawer();
  $('addAdmin').addEventListener('click', () => adminForm(null));
  await loadAdmins();
}

let PERMS = [];

async function loadAdmins() {
  const { administrators, permissions } = await api('/api/admin/administrators');
  PERMS = permissions;
  $('adminTable').innerHTML = `
    <table class="stack">
      <thead><tr><th></th><th>Name</th><th>Role</th><th>Status</th><th>Last signed in</th><th></th></tr></thead>
      <tbody>${administrators.map(adminRow).join('')}</tbody>
    </table>`;

  $('adminTable').querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => adminAction(btn.dataset.act, Number(btn.dataset.id), administrators));
  });
}

function adminRow(a) {
  const isSelf = a.id === BOOT.account.id;
  return `<tr>
    <td>${a.photo ? `<img class="thumb round" src="${esc(a.photo)}" alt="">` : ''}</td>
    <td><strong>${esc(a.full_name)}</strong><br><span class="actor" style="color:var(--muted);font-size:.8rem">${esc(a.email)}</span></td>
    <td><span class="pill ${a.role === 'super_admin' ? 'super' : ''}">${a.role === 'super_admin' ? 'Super Admin' : 'Admin'}</span></td>
    <td><span class="pill ${esc(a.status)}">${esc(a.status)}</span></td>
    <td>${esc(when(a.last_login_at) || 'never')}</td>
    <td class="actions">
      <button class="btn small quiet" data-act="edit" data-id="${a.id}">Edit</button>
      <button class="btn small quiet" data-act="reset" data-id="${a.id}">Reset access</button>
      ${isSelf ? '' : `<button class="btn small quiet" data-act="toggle" data-id="${a.id}">${a.status === 'disabled' ? 'Enable' : 'Disable'}</button>
      <button class="btn small danger" data-act="remove" data-id="${a.id}">Remove</button>`}
    </td>
  </tr>`;
}

function permissionCheckboxes(role, selected) {
  return `<div class="perm-grid">${PERMS.map((p) => {
    const superOnly = p.key === 'manage_administrators' || p.key === 'manage_settings';
    const checked = role === 'super_admin' || selected.includes(p.key);
    const disabled = role === 'super_admin' || superOnly;
    return `<label class="${disabled ? 'locked' : ''}">
      <input type="checkbox" value="${p.key}" ${checked && !(superOnly && role !== 'super_admin') ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
      ${esc(p.label)}${superOnly ? ' <span style="font-size:.7rem">(Super Admin only)</span>' : ''}
    </label>`;
  }).join('')}</div>`;
}

function adminForm(existing) {
  const editing = Boolean(existing);
  const role = existing ? existing.role : 'admin';
  const perms = existing ? existing.permissions : [
    'manage_members', 'manage_team', 'manage_events', 'manage_winners',
    'manage_achievements', 'manage_week_stars', 'manage_star_members', 'manage_gallery'];

  openDrawer(editing ? 'Edit administrator' : 'Add administrator', `
    <div id="drawerNotice"></div>
    <div class="field"><label for="f_name">Full name</label>
      <input id="f_name" value="${esc(existing?.full_name || '')}"></div>
    <div class="field"><label for="f_email">Email address</label>
      <input id="f_email" type="email" value="${esc(existing?.email || '')}" ${editing ? 'disabled' : ''}>
      ${editing ? '<p class="hint">The sign-in address cannot be changed here.</p>' : ''}</div>
    <div class="field"><label for="f_role">Role</label>
      <select id="f_role">
        <option value="admin" ${role === 'admin' ? 'selected' : ''}>Admin</option>
        <option value="super_admin" ${role === 'super_admin' ? 'selected' : ''}>Super Admin</option>
      </select>
      ${editing && existing.id === BOOT.account.id ? '<p class="hint">You cannot change your own role.</p>' : ''}</div>
    <div class="field"><label for="f_photo">Profile photograph (optional)</label>
      <input id="f_photo" type="file" accept="image/*">
      <div class="preview" id="photoPreview">${existing?.photo ? `<img src="${esc(existing.photo)}" alt="">` : ''}</div></div>
    <div class="field"><label>Permissions</label>
      <div id="permBox">${permissionCheckboxes(role, perms)}</div>
      <p class="hint">A Super Admin holds every permission. Managing administrators and website settings can never be granted to a plain Admin.</p></div>
    ${editing ? '' : `<div class="field"><label>How they get in</label>
      <p class="hint" style="margin-top:0">They will receive a one-time setup link and choose their own password. No password is ever shown or stored in the clear.</p></div>`}
  `, {
    saveLabel: editing ? 'Save changes' : 'Create administrator',
    onSave: async () => {
      let photo;
      const file = $('f_photo').files[0];
      if (file) photo = await fileToDataUrl(file);
      const permissions = [...$('permBox').querySelectorAll('input:checked:not(:disabled)')].map((i) => i.value);

      if (editing) {
        await api(`/api/admin/administrators/${existing.id}`, {
          method: 'PATCH',
          body: { full_name: $('f_name').value, role: $('f_role').value, permissions, ...(photo ? { photo } : {}) },
        });
        closeDrawer();
      } else {
        const { setup_link } = await api('/api/admin/administrators', {
          method: 'POST',
          body: { full_name: $('f_name').value, email: $('f_email').value, role: $('f_role').value, permissions, photo },
        });
        closeDrawer();
        notice('pageNotice', 'info',
          `Administrator created. Send them this one-time setup link — it is shown once and expires in 48 hours.<code>${esc(location.origin + setup_link)}</code>`);
      }
      await loadAdmins();
    },
  });

  $('f_role').addEventListener('change', (e) => {
    $('permBox').innerHTML = permissionCheckboxes(e.target.value, perms);
  });
  $('f_photo').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (file) $('photoPreview').innerHTML = `<img src="${await fileToDataUrl(file)}" alt="">`;
  });
}

async function adminAction(act, id, administrators) {
  const target = administrators.find((a) => a.id === id);
  $('pageNotice').innerHTML = '';
  try {
    if (act === 'edit') return adminForm(target);
    if (act === 'toggle') {
      await api(`/api/admin/administrators/${id}`, {
        method: 'PATCH', body: { status: target.status === 'disabled' ? 'active' : 'disabled' },
      });
    }
    if (act === 'reset') {
      if (!confirm(`Reset access for ${target.full_name}? Their password is cleared and every session ends.`)) return;
      const { setup_link } = await api(`/api/admin/administrators/${id}/reset`, { method: 'POST' });
      notice('pageNotice', 'info',
        `Access reset. Send them this one-time link.<code>${esc(location.origin + setup_link)}</code>`);
    }
    if (act === 'remove') {
      if (!confirm(`Remove ${target.full_name}? This cannot be undone.`)) return;
      await api(`/api/admin/administrators/${id}`, { method: 'DELETE' });
    }
    await loadAdmins();
  } catch (err) {
    notice('pageNotice', 'error', esc(err.message));
  }
}

/* ================================ MEMBERS =========================== */

async function pageMembers() {
  await buildShell('/admin/members.html');
  wireDrawer();
  await loadMembers();
}

async function loadMembers() {
  const { members } = await api('/api/admin/members');
  $('memberTable').innerHTML = members.length ? `
    <table class="stack">
      <thead><tr><th>Name</th><th>Course</th><th>Status</th><th>Joined</th><th></th></tr></thead>
      <tbody>${members.map((m) => `<tr>
        <td><strong>${esc(m.full_name)}</strong><br><span style="color:var(--muted);font-size:.8rem">${esc(m.email)}</span></td>
        <td>${esc([m.course, m.year_of_study].filter(Boolean).join(' · '))}</td>
        <td><span class="pill ${esc(m.status)}">${esc(m.status)}</span></td>
        <td>${esc(when(m.created_at, false))}</td>
        <td class="actions">
          ${m.status !== 'approved' ? `<button class="btn small quiet" data-act="approved" data-id="${m.id}">Approve</button>` : ''}
          ${m.status !== 'suspended' ? `<button class="btn small quiet" data-act="suspended" data-id="${m.id}">Suspend</button>`
            : `<button class="btn small quiet" data-act="approved" data-id="${m.id}">Reinstate</button>`}
          <button class="btn small danger" data-act="remove" data-id="${m.id}">Remove</button>
        </td></tr>`).join('')}
      </tbody></table>`
    : '<p class="empty">No one has registered yet. Registrations from the website land here.</p>';

  $('memberTable').querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.id);
      try {
        if (btn.dataset.act === 'remove') {
          if (!confirm('Remove this member permanently?')) return;
          await api(`/api/admin/members/${id}`, { method: 'DELETE' });
        } else {
          await api(`/api/admin/members/${id}`, { method: 'PATCH', body: { status: btn.dataset.act } });
        }
        await loadMembers();
      } catch (err) { notice('pageNotice', 'error', esc(err.message)); }
    });
  });
}

/* ================================ CONTENT =========================== */

let SECTION = null;

async function pageContent() {
  const key = qs.get('section');
  await buildShell('/admin/content.html');
  wireDrawer();

  SECTION = BOOT.sections.find((s) => s.key === key);
  if (!SECTION) {
    $('pageTitle').textContent = 'Not available';
    return notice('pageNotice', 'error',
      'That section does not exist, or you do not have permission to manage it.');
  }
  $('pageTitle').textContent = SECTION.label;
  $('pageSub').textContent = `Everything in ${SECTION.label.toLowerCase()} that appears on the website.`;
  $('addItem').textContent = `Add ${SECTION.singular}`;
  $('addItem').hidden = false;
  $('addItem').addEventListener('click', () => contentForm(null));
  await loadContent();
}

function displayFields() {
  const skip = new Set(['published', 'sort_order']);
  return SECTION.fields.filter((f) => !skip.has(f.name) && f.type !== 'textarea').slice(0, 4);
}

async function loadContent() {
  const { items } = await api(`/api/admin/content/${SECTION.key}`);
  const cols = displayFields();

  $('contentTable').innerHTML = items.length ? `
    <table class="stack">
      <thead><tr>${cols.map((f) => `<th>${esc(f.label)}</th>`).join('')}<th>On site</th><th></th></tr></thead>
      <tbody>${items.map((item) => `<tr>
        ${cols.map((f) => `<td>${cellValue(f, item[f.name])}</td>`).join('')}
        <td><span class="pill ${item.published ? 'active' : ''}">${item.published ? 'visible' : 'hidden'}</span></td>
        <td class="actions">
          <button class="btn small quiet" data-act="edit" data-id="${item.id}">Edit</button>
          <button class="btn small danger" data-act="delete" data-id="${item.id}">Delete</button>
        </td></tr>`).join('')}
      </tbody></table>`
    : `<p class="empty">Nothing here yet. Add the first ${esc(SECTION.singular)} to see it on the website.</p>`;

  $('contentTable').querySelectorAll('[data-act]').forEach((btn) => {
    const item = items.find((i) => i.id === Number(btn.dataset.id));
    btn.addEventListener('click', async () => {
      if (btn.dataset.act === 'edit') return contentForm(item);
      if (!confirm(`Delete this ${SECTION.singular}? This cannot be undone.`)) return;
      try {
        await api(`/api/admin/content/${SECTION.key}/${item.id}`, { method: 'DELETE' });
        await loadContent();
      } catch (err) { notice('pageNotice', 'error', esc(err.message)); }
    });
  });
}

function cellValue(field, value) {
  if (value === null || value === undefined || value === '') return '<span style="color:var(--muted)">—</span>';
  if (field.type === 'image') return `<img class="thumb" src="${esc(value)}" alt="">`;
  if (field.type === 'date') return esc(when(value, false));
  return esc(String(value).slice(0, 80));
}

function fieldInput(field, value) {
  const id = `c_${field.name}`;
  const v = value === null || value === undefined ? (field.default ?? '') : value;
  switch (field.type) {
    case 'textarea':
      return `<textarea id="${id}">${esc(v)}</textarea>`;
    case 'boolean':
      return `<label style="display:flex;gap:.5rem;align-items:center;color:var(--text)">
        <input type="checkbox" id="${id}" ${v ? 'checked' : ''}> Yes</label>`;
    case 'number':
      return `<input type="number" id="${id}" value="${esc(v)}">`;
    case 'date':
      return `<input type="date" id="${id}" value="${esc(v)}">`;
    case 'select':
      return `<select id="${id}">${field.options.map((o) =>
        `<option value="${esc(o)}" ${String(v) === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    case 'image':
      return `<input type="file" id="${id}" accept="image/*">
        <div class="preview" id="${id}_preview">${v ? `<img src="${esc(v)}" alt="">` : ''}</div>`;
    default:
      return `<input id="${id}" value="${esc(v)}">`;
  }
}

function contentForm(existing) {
  const editing = Boolean(existing);
  openDrawer(
    `${editing ? 'Edit' : 'Add'} ${SECTION.singular}`,
    `<div id="drawerNotice"></div>` + SECTION.fields.map((f) => `
      <div class="field">
        <label for="c_${f.name}">${esc(f.label)}${f.required ? ' *' : ''}</label>
        ${fieldInput(f, existing ? existing[f.name] : undefined)}
      </div>`).join(''),
    {
      saveLabel: editing ? 'Save changes' : `Add ${SECTION.singular}`,
      onSave: async () => {
        const body = {};
        for (const f of SECTION.fields) {
          const el = $(`c_${f.name}`);
          if (f.type === 'boolean') body[f.name] = el.checked;
          else if (f.type === 'image') {
            const file = el.files[0];
            if (file) body[f.name] = await fileToDataUrl(file);
            else if (editing) continue;            // leave the stored image alone
            else body[f.name] = null;
          } else body[f.name] = el.value;
        }
        if (editing) {
          await api(`/api/admin/content/${SECTION.key}/${existing.id}`, { method: 'PATCH', body });
        } else {
          await api(`/api/admin/content/${SECTION.key}`, { method: 'POST', body });
        }
        closeDrawer();
        await loadContent();
      },
    }
  );

  for (const f of SECTION.fields.filter((x) => x.type === 'image')) {
    $(`c_${f.name}`).addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) $(`c_${f.name}_preview`).innerHTML = `<img src="${await fileToDataUrl(file)}" alt="">`;
    });
  }
}

/* ================================= AUDIT ============================ */

async function pageAudit() {
  await buildShell('/admin/audit.html');
  const { entries } = await api('/api/admin/audit?limit=300');
  $('auditTable').innerHTML = entries.length ? `
    <table class="stack">
      <thead><tr><th>When</th><th>Who</th><th>Action</th><th>What happened</th></tr></thead>
      <tbody>${entries.map((e) => `<tr>
        <td style="white-space:nowrap;color:var(--muted);font-size:.83rem">${esc(when(e.created_at))}</td>
        <td>${esc(e.actor_name || 'system')}<br><span style="color:var(--muted);font-size:.78rem">${esc(e.actor_role || '')}</span></td>
        <td><span class="pill">${esc(e.action)}</span></td>
        <td>${esc(e.summary)}</td></tr>`).join('')}
      </tbody></table>`
    : '<p class="empty">Nothing recorded yet.</p>';
}

/* =============================== SETTINGS =========================== */

const SETTING_FIELDS = [
  { key: 'site_title', label: 'Website title' },
  { key: 'tagline', label: 'Tagline' },
  { key: 'about', label: 'About the club', type: 'textarea' },
  { key: 'contact_email', label: 'Contact email' },
  { key: 'contact_phone', label: 'Contact phone' },
  { key: 'address', label: 'Address' },
  { key: 'instagram', label: 'Instagram link' },
  { key: 'linkedin', label: 'LinkedIn link' },
  { key: 'youtube', label: 'YouTube link' },
];

async function pageSettings() {
  await buildShell('/admin/settings.html');
  const { settings } = await api('/api/admin/settings');
  $('settingsForm').innerHTML = SETTING_FIELDS.map((f) => `
    <div class="field">
      <label for="s_${f.key}">${esc(f.label)}</label>
      ${f.type === 'textarea'
        ? `<textarea id="s_${f.key}">${esc(settings[f.key] || '')}</textarea>`
        : `<input id="s_${f.key}" value="${esc(settings[f.key] || '')}">`}
    </div>`).join('')
    + `<div class="field"><label style="display:flex;gap:.5rem;align-items:center;color:var(--text)">
        <input type="checkbox" id="s_join_open" ${settings.join_open !== 'false' ? 'checked' : ''}>
        Member registration is open</label></div>
      <button class="btn" id="saveSettings" type="button">Save settings</button>`;

  $('saveSettings').addEventListener('click', async () => {
    const body = Object.fromEntries(SETTING_FIELDS.map((f) => [f.key, $(`s_${f.key}`).value]));
    body.join_open = $('s_join_open').checked ? 'true' : 'false';
    try {
      await api('/api/admin/settings', { method: 'PUT', body });
      notice('pageNotice', 'ok', 'Settings saved.');
    } catch (err) { notice('pageNotice', 'error', esc(err.message)); }
  });
}

/* ================================ ROUTER ============================ */

const PAGES = {
  login: pageLogin,
  'set-password': pageSetPassword,
  dashboard: pageDashboard,
  administrators: pageAdministrators,
  members: pageMembers,
  content: pageContent,
  audit: pageAudit,
  settings: pageSettings,
};

const page = document.body.dataset.page;
if (PAGES[page]) {
  PAGES[page]().catch((err) => {
    if (err.message === 'Session ended.') return;
    console.error(err);
    notice('pageNotice', 'error', esc(err.message));
  });
}
