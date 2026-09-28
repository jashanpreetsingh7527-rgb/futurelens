#!/usr/bin/env node
'use strict';
/**
 * Optional. Fills Supabase with example content.
 *
 *   node seed-demo.js
 */
const path = require('node:path');
const fs = require('node:fs');

(function loadEnvFile() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[k] === undefined) process.env[k] = v;
  }
})();

const { supabase, now } = require('./lib/db');

async function insert(table, rows) {
  const formatted = rows.map((r) => ({ ...r, created_at: now(), updated_at: now() }));
  const { error } = await supabase.from(`content_${table}`).insert(formatted);
  if (error) console.error(`Error inserting into ${table}:`, error.message);
}

async function run() {
  const { count } = await supabase.from('content_events').select('*', { count: 'exact', head: true });
  if (count && count > 0) {
    console.log('\n  Content already exists in database. Nothing seeded.\n');
    process.exit(0);
  }

  await insert('statistics', [
    { label: 'Members', value: '148', sort_order: 1, published: 1 },
    { label: 'Shoots this year', value: '26', sort_order: 2, published: 1 },
    { label: 'Competitions won', value: '9', sort_order: 3, published: 1 },
    { label: 'Founded', value: '2021', sort_order: 4, published: 1 },
  ]);

  await insert('events', [
    { title: 'Night photography walk', starts_on: '2026-10-02', time_text: '7:30 pm',
      venue: 'Clock Tower, main campus', status: 'upcoming', published: 1,
      summary: 'Long exposures after dark. Bring a tripod if you have one; the club has four to lend.' },
    { title: 'Portrait lighting workshop', starts_on: '2026-10-19', time_text: '4:00 pm',
      venue: 'Studio, Block C', status: 'upcoming', published: 1,
      summary: 'One light, one reflector, one afternoon. No equipment needed.' },
    { title: 'Monsoon photo contest', starts_on: '2026-08-14', venue: 'Online submission',
      status: 'past', published: 1, summary: 'Ninety-one entries judged on composition and timing.' },
  ]);

  await insert('week_stars', [
    { name: 'Aditi Sharma', week_of: '2026-09-07', course: 'B.Des, second year', published: 1,
      reason: 'Her series from the monsoon contest showed real patience — she went back to the same street four evenings running until the light did what she wanted.' },
  ]);

  await insert('winners', [
    { name: 'Aditi Sharma', competition: 'Monsoon photo contest', position: 'First place',
      awarded_on: '2026-08-14', entry_title: 'Sixth Evening', published: 1 },
    { name: 'Rohan Mehta', competition: 'Monsoon photo contest', position: 'Second place',
      awarded_on: '2026-08-14', entry_title: 'Bus Stand, 6am', published: 1 },
    { name: 'Ishita Bansal', competition: 'Campus in Black & White', position: 'First place',
      awarded_on: '2026-05-22', entry_title: 'Stairwell', published: 1 },
  ]);

  await insert('achievements', [
    { title: 'Selected for the National Student Photography Exhibition', holder: 'Ishita Bansal',
      achieved_on: '2026-07-03', published: 1,
      detail: 'Two prints accepted from over four thousand submissions.' },
    { title: 'Documentary short screened at the district film festival', holder: 'FUTURELENS film unit',
      achieved_on: '2026-03-11', published: 1, detail: 'A twelve-minute piece on the city’s last hand-painted signboards.' },
  ]);

  await insert('star_members', [
    { name: 'Rohan Mehta', course: 'B.Tech CSE, third year', sort_order: 1, published: 1,
      citation: 'Runs the equipment library and has never once let a shoot go ahead with a flat battery.' },
    { name: 'Ishita Bansal', course: 'BA English, second year', sort_order: 2, published: 1,
      citation: 'Built the club archive from scratch and catalogued six years of loose files.' },
  ]);

  await insert('team', [
    { name: 'Aditi Sharma', role: 'President', course: 'B.Des, second year', sort_order: 1, published: 1,
      bio: 'Speak to Aditi about joining, collaborations and anything to do with competitions.' },
    { name: 'Rohan Mehta', role: 'Equipment secretary', course: 'B.Tech CSE, third year', sort_order: 2, published: 1,
      bio: 'Handles the camera and lens library, and the booking sheet for the studio.' },
    { name: 'Ishita Bansal', role: 'Archivist', course: 'BA English, second year', sort_order: 3, published: 1,
      bio: 'Keeps the gallery and the club archive in order.' },
  ]);

  await insert('pages', [
    { slug: 'about', title: 'About FUTURELENS', published: 1,
      body: 'FUTURELENS started in 2021 with six students and one borrowed camera. We run weekly shoots, a monthly critique session and two open competitions a year.\n\nMembership is open to every student of the university, in any year and on any course. You do not need your own camera — the club lends equipment to members for shoots and assignments.' },
    { slug: 'privacy', title: 'Privacy Policy', published: 1,
      body: 'This notice explains what the club does with the information you give it. Replace this text with your own before the site goes live.\n\nWhen you register as a member we store your name, email address, course and year, and a securely hashed version of your password. We use these to confirm your membership and to contact you about club activity.' },
    { slug: 'terms', title: 'Terms of Use', published: 1,
      body: 'These terms cover the use of this website and the club equipment. Replace this text with your own before the site goes live.\n\nMember accounts are personal. Do not share your password or let anyone else sign in as you.' },
  ]);

  for (const [key, value] of Object.entries({
    tagline: 'Look closer. Frame it better. Tell the story properly.',
    about: 'Membership is open to every student, whatever you shoot with — phone, film or full frame. Register here and the committee will confirm your place.',
    contact_email: 'hello@futurelens.club',
    contact_phone: '+91 00000 00000',
    address: 'Student Activity Centre, Room 14',
  })) {
    await supabase.from('settings').upsert({ key, value, updated_at: now() });
  }

  console.log('\n  Demo content added to Supabase. Open the site to see it.\n');
}

run().catch((err) => {
  console.error('\nSeeding failed:', err.message, '\n');
  process.exit(1);
});
