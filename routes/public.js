'use strict';
const { supabase, RESOURCES } = require('../lib/db');
const { json, fail } = require('../lib/http');

const PUBLIC_LIMIT = { gallery: 60, events: 40, winners: 40, achievements: 40, week_stars: 12 };

async function published(name, limit) {
  const res = RESOURCES[name];
  if (!res) return [];
  let query = supabase.from(`content_${name}`).select('*');
  const hasPublished = res.fields.some((f) => f.name === 'published');
  if (hasPublished) {
    query = query.eq('published', 1);
  }
  if (res.orderBy) {
    query = query.order(res.orderBy.column, { ascending: res.orderBy.ascending });
  }
  if (res.secondaryOrderBy) {
    query = query.order(res.secondaryOrderBy.column, { ascending: res.secondaryOrderBy.ascending });
  }
  query = query.limit(limit || PUBLIC_LIMIT[name] || 100);
  const { data, error } = await query;
  if (error) {
    console.error(`Error querying ${name}:`, error.message);
    return [];
  }
  return data || [];
}

module.exports = function register(router) {

  router.get('/api/site', async (req, res) => {
    const { data: settingsRows } = await supabase.from('settings').select('key, value');
    const settings = Object.fromEntries(
      (settingsRows || []).map((r) => [r.key, r.value])
    );

    const [
      weekStars,
      statistics,
      starMembers,
      events,
      winners,
      achievements,
      gallery,
      team,
      pages,
      memberCountRes,
    ] = await Promise.all([
      published('week_stars', 1),
      published('statistics'),
      published('star_members'),
      published('events'),
      published('winners'),
      published('achievements'),
      published('gallery'),
      published('team'),
      published('pages'),
      supabase.from('members').select('*', { count: 'exact', head: true }).eq('status', 'approved'),
    ]);

    json(res, 200, {
      settings: {
        site_title: settings.site_title || 'FUTURELENS',
        tagline: settings.tagline || '',
        about: settings.about || '',
        contact_email: settings.contact_email || '',
        contact_phone: settings.contact_phone || '',
        address: settings.address || '',
        instagram: settings.instagram || '',
        linkedin: settings.linkedin || '',
        youtube: settings.youtube || '',
        join_open: settings.join_open !== 'false',
      },
      week_star: weekStars[0] || null,
      statistics,
      star_members: starMembers,
      events,
      winners,
      achievements,
      gallery,
      team,
      pages: pages.map((p) => ({ slug: p.slug, title: p.title })),
      member_count: memberCountRes.count || 0,
    });
  });

  router.get('/api/public/:resource', async (req, res) => {
    const name = req.params.resource;
    const resource = RESOURCES[name];
    if (!resource || !resource.public) throw fail(404, 'Not found.');
    const items = await published(name);
    json(res, 200, { items });
  });

  router.get('/api/page/:slug', async (req, res) => {
    const { data: page, error } = await supabase
      .from('content_pages')
      .select('title, body, slug')
      .eq('slug', req.params.slug)
      .eq('published', 1)
      .maybeSingle();

    if (error || !page) throw fail(404, 'That page does not exist.');
    json(res, 200, { page });
  });
};
