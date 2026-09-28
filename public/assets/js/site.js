'use strict';

const $ = (id) => document.getElementById(id);

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDate(iso, opts = { day: 'numeric', month: 'long', year: 'numeric' }) {
  if (!iso) return '';
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', opts);
}

function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

const empty = (message) => `<p class="empty">${esc(message)}</p>`;

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
  return data;
}

/* ------------------------------ rendering -------------------------- */

function renderWeekStar(star) {
  const node = $('weekStar');
  if (!star) {
    node.innerHTML = `
      <span class="ribbon">WEEK STAR</span>
      <span class="corner tl"></span><span class="corner br"></span>
      <div class="plate">
        <div class="blank">☆</div>
        <figcaption>
          <strong>Nobody yet</strong>
          <span class="meta">The committee names one member every week.</span>
        </figcaption>
      </div>`;
    return;
  }
  node.innerHTML = `
    <span class="ribbon">WEEK STAR</span>
    <span class="corner tl"></span><span class="corner br"></span>
    <div class="plate">
      ${star.photo
        ? `<img src="${esc(star.photo)}" alt="${esc(star.name)}">`
        : `<div class="blank">${esc(initials(star.name))}</div>`}
      <figcaption>
        <strong>${esc(star.name)}</strong>
        <span class="meta">${esc([star.course, `week of ${fmtDate(star.week_of, { day: 'numeric', month: 'short' })}`]
          .filter(Boolean).join(' · '))}</span>
        ${star.reason ? `<p>${esc(star.reason)}</p>` : ''}
      </figcaption>
    </div>`;
}

function renderStats(stats, memberCount) {
  const items = [...stats];
  if (memberCount > 0 && !items.some((s) => /member/i.test(s.label))) {
    items.unshift({ label: 'Members', value: String(memberCount) });
  }
  if (!items.length) return;
  $('statBand').hidden = false;
  $('stats').innerHTML = items.map((s) =>
    `<div class="stat"><b>${esc(s.value)}</b><span>${esc(s.label)}</span></div>`).join('');
}

function renderEvents(events) {
  if (!events.length) return void ($('eventsList').innerHTML = empty('Nothing scheduled yet. Check back soon.'));
  $('eventsList').innerHTML = `<div class="events">${events.map((e) => {
    const d = e.starts_on ? new Date(e.starts_on + 'T00:00:00') : null;
    return `<article class="event">
      <div class="date">
        <b>${d ? d.getDate() : '—'}</b>
        <span>${d ? d.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase() : 'TBC'}</span>
      </div>
      ${e.cover ? `<img class="cover" src="${esc(e.cover)}" alt="" loading="lazy">` : '<div class="cover none"></div>'}
      <div>
        <h3>${esc(e.title)}</h3>
        <div class="meta">${[e.time_text, e.venue].filter(Boolean).map(esc).join(' · ')}</div>
        ${e.summary ? `<p>${esc(e.summary)}</p>` : ''}
        ${e.registration_url && e.status === 'upcoming'
          ? `<p style="margin-top:.7rem"><a class="btn small quiet" href="${esc(e.registration_url)}">Register</a></p>` : ''}
      </div>
      <span class="tag ${e.status === 'upcoming' ? 'upcoming' : ''}">${esc((e.status || '').toUpperCase())}</span>
    </article>`;
  }).join('')}</div>`;
}

const PLACES = ['FIRST PLACE', 'SECOND PLACE', 'THIRD PLACE'];

function renderWinners(winners) {
  if (!winners.length) return void ($('winnersList').innerHTML = empty('No results recorded yet.'));

  // The three most recent results lead as a podium; the rest run as a ledger.
  const top = winners.slice(0, 3);
  const rest = winners.slice(3);

  const podium = `<div class="podium">${top.map((w, i) => `
    <article class="medal r${i + 1}">
      <div class="ring">
        ${w.photo ? `<img src="${esc(w.photo)}" alt="${esc(w.name)}">`
          : `<div class="noimg">${esc(initials(w.name))}</div>`}
      </div>
      <div class="place">${esc(w.position ? w.position.toUpperCase() : PLACES[i])}</div>
      <h3>${esc(w.name)}</h3>
      <div class="what">${esc([w.competition, w.entry_title].filter(Boolean).join(' — '))}</div>
      <div class="when">${esc(fmtDate(w.awarded_on))}</div>
    </article>`).join('')}</div>`;

  const ledger = rest.length ? `<ul class="ledger">${rest.map((w) => `
    <li>
      ${w.photo ? `<img class="portrait" src="${esc(w.photo)}" alt="">`
        : `<div class="portrait">${esc(initials(w.name))}</div>`}
      <div>
        <div class="who">${esc(w.name)}</div>
        <div class="what">${esc([w.competition, w.entry_title].filter(Boolean).join(' — '))}</div>
        ${w.position ? `<div class="position">${esc(w.position)}</div>` : ''}
      </div>
      <div class="when">${esc(fmtDate(w.awarded_on))}</div>
    </li>`).join('')}</ul>` : '';

  $('winnersList').innerHTML = podium + ledger;
}

function renderAchievements(rows) {
  if (!rows.length) return void ($('achievementsList').innerHTML = empty('No achievements recorded yet.'));
  $('achievementsList').innerHTML = `<ul class="timeline">${rows.map((a) => `
    <li>
      <div class="meta">${esc([fmtDate(a.achieved_on), a.holder].filter(Boolean).join(' · '))}</div>
      <h3>${esc(a.title)}</h3>
      ${a.detail ? `<p>${esc(a.detail)}</p>` : ''}
    </li>`).join('')}</ul>`;
}

function renderPeople(target, rows, mapper, emptyText) {
  if (!rows.length) return void ($(target).innerHTML = empty(emptyText));
  $(target).innerHTML = `<div class="people">${rows.map((r) => {
    const m = mapper(r);
    return `<figure class="person">
      <div class="shot">
        ${m.badge ? `<span class="badge">${esc(m.badge)}</span>` : ''}
        ${m.photo ? `<img src="${esc(m.photo)}" alt="${esc(m.name)}" loading="lazy">`
          : `<div class="noimg">${esc(initials(m.name))}</div>`}
      </div>
      <figcaption>
        <b>${esc(m.name)}</b>
        ${m.sub ? `<span>${esc(m.sub)}</span>` : ''}
        ${m.note ? `<p>${esc(m.note)}</p>` : ''}
      </figcaption>
    </figure>`;
  }).join('')}</div>`;
}

/* -------------------------- gallery + lightbox --------------------- */

let PHOTOS = [];
let SHOWN = [];
let lbIndex = 0;

function renderGallery(photos, album = 'All') {
  PHOTOS = photos;
  const albums = [...new Set(photos.map((p) => p.album).filter(Boolean))];

  if (albums.length > 1) {
    $('galleryChips').hidden = false;
    $('galleryChips').innerHTML = ['All', ...albums].map((a) =>
      `<button class="chip ${a === album ? 'on' : ''}" data-album="${esc(a)}">${esc(a)}</button>`).join('');
    $('galleryChips').querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => renderGallery(PHOTOS, chip.dataset.album));
    });
  }

  SHOWN = album === 'All' ? photos : photos.filter((p) => p.album === album);
  if (!SHOWN.length) return void ($('galleryList').innerHTML = empty('No photographs published yet.'));

  $('galleryList').innerHTML = `<div class="sheet">${SHOWN.map((p, i) => `
    <figure tabindex="0" role="button" data-i="${i}" aria-label="${esc(p.caption || 'Open photograph')}">
      <img src="${esc(p.image)}" alt="${esc(p.caption || 'Club photograph')}" loading="lazy">
      <figcaption>
        ${p.caption ? `<b>${esc(p.caption)}</b>` : ''}
        <span>${esc([p.credit && `Photograph by ${p.credit}`, fmtDate(p.taken_on, { month: 'short', year: 'numeric' })]
          .filter(Boolean).join(' · '))}</span>
      </figcaption>
    </figure>`).join('')}</div>`;

  $('galleryList').querySelectorAll('figure').forEach((fig) => {
    const open = () => openLightbox(Number(fig.dataset.i));
    fig.addEventListener('click', open);
    fig.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  });
}

function openLightbox(i) {
  lbIndex = (i + SHOWN.length) % SHOWN.length;
  const p = SHOWN[lbIndex];
  $('lbImg').src = p.image;
  $('lbImg').alt = p.caption || 'Club photograph';
  $('lbCap').innerHTML = `${esc(p.caption || '')}<span>${esc(
    [p.credit && `Photograph by ${p.credit}`, fmtDate(p.taken_on)].filter(Boolean).join(' · '))}</span>`;
  $('lightbox').classList.add('open');
  document.body.style.overflow = 'hidden';
  $('lbClose').focus();
}

function closeLightbox() {
  $('lightbox').classList.remove('open');
  document.body.style.overflow = '';
}

$('lbClose').addEventListener('click', closeLightbox);
$('lbPrev').addEventListener('click', () => openLightbox(lbIndex - 1));
$('lbNext').addEventListener('click', () => openLightbox(lbIndex + 1));
$('lightbox').addEventListener('click', (e) => { if (e.target === $('lightbox')) closeLightbox(); });
document.addEventListener('keydown', (e) => {
  if (!$('lightbox').classList.contains('open')) return;
  if (e.key === 'Escape') closeLightbox();
  if (e.key === 'ArrowLeft') openLightbox(lbIndex - 1);
  if (e.key === 'ArrowRight') openLightbox(lbIndex + 1);
});

/* -------------------------------- footer --------------------------- */

const SOCIAL_LABEL = { instagram: 'IG', linkedin: 'IN', youtube: 'YT' };

function renderFooter(settings, pages) {
  const name = (settings.site_title || 'FUTURELENS').toUpperCase();

  $('footAbout').textContent = 'A student club for photography, media and storytelling. Open to every student, whatever you shoot with.';

  $('footContact').innerHTML = [
    settings.address && `<span>${esc(settings.address)}</span>`,
    settings.contact_email && `<a href="mailto:${esc(settings.contact_email)}">${esc(settings.contact_email)}</a>`,
    settings.contact_phone && `<a href="tel:${esc(settings.contact_phone.replace(/\s/g, ''))}">${esc(settings.contact_phone)}</a>`,
  ].filter(Boolean).join('') || '<span>Contact details coming soon.</span>';

  $('footLinks').innerHTML = ['instagram', 'linkedin', 'youtube']
    .filter((k) => settings[k])
    .map((k) => `<a href="${esc(settings[k])}" aria-label="${k}" rel="noopener">${SOCIAL_LABEL[k]}</a>`)
    .join('');

  // Anything published under Pages in the admin area shows up here.
  const legalSlugs = ['privacy', 'terms', 'privacy-policy', 'terms-of-use'];
  const info = pages.filter((p) => !legalSlugs.includes(p.slug));
  const legal = pages.filter((p) => legalSlugs.includes(p.slug));

  $('footPages').innerHTML = info
    .map((p) => `<a href="/page.html?slug=${encodeURIComponent(p.slug)}">${esc(p.title)}</a>`).join('');

  $('footCopy').textContent = `© ${new Date().getFullYear()} ${name}. All rights reserved.`;
  $('footLegal').innerHTML = legal
    .map((p) => `<a href="/page.html?slug=${encodeURIComponent(p.slug)}">${esc(p.title)}</a>`).join('');
}

/* --------------------------------- boot ---------------------------- */

async function load() {
  let site;
  try {
    site = await api('/api/site');
  } catch {
    $('eventsList').innerHTML = empty('The site could not load its content. Refresh to try again.');
    return;
  }

  const s = site.settings;
  const name = (s.site_title || 'FUTURELENS').toUpperCase();
  document.title = `${name} — See the future, shape the future`;
  $('brand').textContent = name;
  $('heroTitle').textContent = name;
  if (s.tagline) $('heroLede').textContent = s.tagline;
  if (s.about) $('aboutText').textContent = s.about;

  renderWeekStar(site.week_star);
  renderStats(site.statistics, site.member_count);
  renderEvents(site.events);
  renderWinners(site.winners);
  renderAchievements(site.achievements);
  renderPeople('starList', site.star_members, (m) => ({
    photo: m.photo, name: m.name, sub: m.course, note: m.citation, badge: 'STAR',
  }), 'No Star Members named yet.');
  renderPeople('teamList', site.team, (t) => ({
    photo: t.photo, name: t.name, sub: t.role, note: [t.course, t.bio].filter(Boolean).join(' — '),
  }), 'The committee has not been published yet.');
  renderGallery(site.gallery);
  renderFooter(s, site.pages || []);

  if (!s.join_open) {
    $('registerForm').innerHTML = '<h3>Member registration</h3>'
      + '<p class="empty">Registration is closed at the moment. Follow the club for the next intake.</p>';
  }
}

/* ------------------------------ interaction ------------------------ */

function notice(target, kind, message) {
  $(target).innerHTML = `<div class="notice ${kind}">${esc(message)}</div>`;
}

const onScroll = () => $('masthead').classList.toggle('scrolled', window.scrollY > 8);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

$('navToggle').addEventListener('click', () => {
  const open = $('nav').classList.toggle('open');
  $('navToggle').setAttribute('aria-expanded', String(open));
});
$('nav').addEventListener('click', (e) => {
  if (e.target.closest('a')) {
    $('nav').classList.remove('open');
    $('navToggle').setAttribute('aria-expanded', 'false');
  }
});

function showSignIn(e) {
  if (e) e.preventDefault();
  $('registerForm').hidden = true;
  $('signinForm').hidden = false;
  $('s_email').focus();
}
$('toSignIn').addEventListener('click', showSignIn);
$('footSignIn').addEventListener('click', showSignIn);
$('toRegister').addEventListener('click', (e) => {
  e.preventDefault();
  $('signinForm').hidden = true;
  $('registerForm').hidden = false;
  $('r_name').focus();
});

$('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('registerBtn');
  btn.disabled = true;
  $('registerNotice').innerHTML = '';
  const body = Object.fromEntries(new FormData(e.target).entries());
  try {
    await api('/api/register', { method: 'POST', body });
    e.target.reset();
    notice('registerNotice', 'ok',
      'Account created. The committee will approve your membership shortly — you can sign in now.');
  } catch (err) {
    notice('registerNotice', 'error', err.message);
  } finally {
    btn.disabled = false;
  }
});

$('signinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('signinNotice').innerHTML = '';
  const body = Object.fromEntries(new FormData(e.target).entries());
  try {
    const { account } = await api('/api/login', { method: 'POST', body });
    notice('signinNotice', 'ok', `Signed in as ${account.full_name}.`
      + (account.status === 'pending' ? ' Your membership is awaiting approval.' : ''));
  } catch (err) {
    notice('signinNotice', 'error', err.message);
  }
});

load();
