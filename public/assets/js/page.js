'use strict';

const $ = (id) => document.getElementById(id);
const SOCIAL_LABEL = { instagram: 'IG', linkedin: 'IN', youtube: 'YT' };

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function api(path) {
  const res = await fetch(path, { credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'That page could not be loaded.');
  return data;
}

// Page bodies are plain text typed by a committee member, so paragraphs are
// split on blank lines and everything is escaped — no HTML is trusted.
function paragraphs(body) {
  return String(body || '').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)
    .map((b) => `<p>${esc(b).replace(/\n/g, '<br>')}</p>`).join('');
}

function renderFooter(settings, pages) {
  const name = (settings.site_title || 'FUTURELENS').toUpperCase();
  $('brand').textContent = name;

  $('footAbout').textContent = 'A student club for photography, media and storytelling.';

  $('footContact').innerHTML = [
    settings.address && `<span>${esc(settings.address)}</span>`,
    settings.contact_email && `<a href="mailto:${esc(settings.contact_email)}">${esc(settings.contact_email)}</a>`,
    settings.contact_phone && `<a href="tel:${esc(settings.contact_phone.replace(/\s/g, ''))}">${esc(settings.contact_phone)}</a>`,
  ].filter(Boolean).join('') || '<span>Contact details coming soon.</span>';

  $('footLinks').innerHTML = ['instagram', 'linkedin', 'youtube']
    .filter((k) => settings[k])
    .map((k) => `<a href="${esc(settings[k])}" aria-label="${k}" rel="noopener">${SOCIAL_LABEL[k]}</a>`).join('');

  const legalSlugs = ['privacy', 'terms', 'privacy-policy', 'terms-of-use'];
  $('footPages').innerHTML = pages.filter((p) => !legalSlugs.includes(p.slug))
    .map((p) => `<a href="/page.html?slug=${encodeURIComponent(p.slug)}">${esc(p.title)}</a>`).join('');
  $('footLegal').innerHTML = pages.filter((p) => legalSlugs.includes(p.slug))
    .map((p) => `<a href="/page.html?slug=${encodeURIComponent(p.slug)}">${esc(p.title)}</a>`).join('');
  $('footCopy').textContent = `© ${new Date().getFullYear()} ${name}. All rights reserved.`;
}

$('navToggle').addEventListener('click', () => {
  const open = $('nav').classList.toggle('open');
  $('navToggle').setAttribute('aria-expanded', String(open));
});

(async function load() {
  const slug = new URLSearchParams(location.search).get('slug');

  try {
    const site = await api('/api/site');
    renderFooter(site.settings, site.pages || []);
  } catch { /* the page body matters more than the footer */ }

  if (!slug) {
    $('article').innerHTML = '<p class="empty">No page was requested. <a href="/">Back to the website</a>.</p>';
    return;
  }

  try {
    const { page } = await api(`/api/page/${encodeURIComponent(slug)}`);
    document.title = `${page.title} · FUTURELENS`;
    $('article').innerHTML = `<h1>${esc(page.title)}</h1>${paragraphs(page.body)}`;
  } catch (err) {
    $('article').innerHTML = `<p class="empty">${esc(err.message)} <a href="/">Back to the website</a>.</p>`;
  }
})();
