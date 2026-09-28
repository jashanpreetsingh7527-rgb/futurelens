#!/usr/bin/env node
'use strict';
/**
 * Creates the first FUTURELENS Super Admin in Supabase.
 *
 *   node setup.js
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
const A = require('./lib/auth');

const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || '';
const name = (process.env.ADMIN_NAME || 'Super Admin').trim();

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

async function run() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    die('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env before running setup.');
  }

  if (!email || !password) {
    die('Set ADMIN_EMAIL and ADMIN_PASSWORD (in .env or on the command line) and run this again.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) die('ADMIN_EMAIL is not a valid email address.');

  const problem = A.passwordProblem(password);
  if (problem) die(`ADMIN_PASSWORD rejected: ${problem}`);

  const { data: existing, error: errCheck } = await supabase
    .from('admins')
    .select('id, email')
    .eq('role', 'super_admin');

  if (errCheck) {
    die(`Database check failed: ${errCheck.message}. Did you run supabase_schema.sql in your Supabase SQL Editor?`);
  }

  if (existing && existing.length && process.argv[2] !== '--force') {
    console.log(`\n  A Super Admin already exists (${existing.map((a) => a.email).join(', ')}).`);
    console.log('  Create further administrators from /admin/administrators.html.');
    console.log('  Re-run with --force only to reset this account\'s password.\n');
    process.exit(0);
  }

  const hash = A.hashPassword(password);
  const { data: already } = await supabase.from('admins').select('id').eq('email', email).maybeSingle();

  if (already) {
    await supabase.from('admins').update({
      password_hash: hash,
      role: 'super_admin',
      status: 'active',
      full_name: name,
    }).eq('id', already.id);
    console.log(`\n  Reset the Super Admin password for ${email}.`);
  } else {
    await supabase.from('admins').insert({
      full_name: name,
      email,
      password_hash: hash,
      role: 'super_admin',
      status: 'active',
      permissions: '[]',
      created_at: now(),
    });
    console.log(`\n  Created Super Admin ${email}.`);
  }

  await supabase.from('audit_log').insert({
    actor_name: name,
    actor_role: 'super_admin',
    action: 'setup',
    entity: 'admin',
    summary: `Super Admin ${email} created through deployment setup.`,
    created_at: now(),
  });

  const defaults = {
    site_title: 'FUTURELENS',
    tagline: 'The photography and media club',
    about: 'FUTURELENS brings together students who want to see, frame and tell better stories.',
    join_open: 'true',
  };
  for (const [key, value] of Object.entries(defaults)) {
    await supabase.from('settings').upsert({ key, value, updated_at: now() });
  }

  console.log('  Sign in at /admin/login.html');
  console.log('  Now remove ADMIN_PASSWORD from .env.\n');
}

run().catch((err) => {
  console.error('\nSetup error:', err.message, '\n');
  process.exit(1);
});
