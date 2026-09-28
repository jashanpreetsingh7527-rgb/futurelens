'use strict';
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || '';

let supabase = null;
if (supabaseUrl && supabaseKey) {
  supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
} else {
  console.warn('\n[FUTURELENS] Note: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set.');
  console.warn('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env or your hosting dashboard.\n');
}

/* ------------------------------------------------------------------ *
 * Permissions
 * ------------------------------------------------------------------ */

const PERMISSIONS = [
  { key: 'manage_members', label: 'Manage members' },
  { key: 'manage_team', label: 'Manage team' },
  { key: 'manage_events', label: 'Manage events' },
  { key: 'manage_winners', label: 'Manage winners' },
  { key: 'manage_achievements', label: 'Manage achievements' },
  { key: 'manage_week_stars', label: 'Manage Week Stars' },
  { key: 'manage_star_members', label: 'Manage Star Members' },
  { key: 'manage_gallery', label: 'Manage gallery' },
  { key: 'manage_pages', label: 'Manage pages' },
  { key: 'manage_statistics', label: 'Manage statistics' },
  { key: 'manage_contact', label: 'Manage contact information' },
  { key: 'manage_settings', label: 'Manage website settings' },
  { key: 'manage_administrators', label: 'Manage administrators' },
];

const SUPER_ONLY_PERMISSIONS = new Set(['manage_administrators', 'manage_settings']);

const DEFAULT_ADMIN_PERMISSIONS = [
  'manage_members', 'manage_team', 'manage_events', 'manage_winners',
  'manage_achievements', 'manage_week_stars', 'manage_star_members', 'manage_gallery',
];

/* ------------------------------------------------------------------ *
 * Content resources
 * ------------------------------------------------------------------ */

const RESOURCES = {
  team: {
    label: 'Team',
    singular: 'team member',
    permission: 'manage_team',
    public: true,
    orderBy: { column: 'sort_order', ascending: true },
    secondaryOrderBy: { column: 'id', ascending: false },
    fields: [
      { name: 'name', label: 'Name', type: 'text', required: true },
      { name: 'role', label: 'Role in club', type: 'text' },
      { name: 'course', label: 'Course / year', type: 'text' },
      { name: 'photo', label: 'Photograph', type: 'image' },
      { name: 'bio', label: 'Short bio', type: 'textarea' },
      { name: 'email', label: 'Email', type: 'text' },
      { name: 'sort_order', label: 'Display order', type: 'number', default: 0 },
      { name: 'published', label: 'Show on website', type: 'boolean', default: 1 },
    ],
  },
  events: {
    label: 'Events',
    singular: 'event',
    permission: 'manage_events',
    public: true,
    orderBy: { column: 'starts_on', ascending: false },
    secondaryOrderBy: { column: 'id', ascending: false },
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'starts_on', label: 'Date', type: 'date' },
      { name: 'time_text', label: 'Time', type: 'text' },
      { name: 'venue', label: 'Venue', type: 'text' },
      { name: 'cover', label: 'Cover image', type: 'image' },
      { name: 'summary', label: 'Summary', type: 'textarea' },
      { name: 'registration_url', label: 'Registration link', type: 'text' },
      { name: 'status', label: 'Status', type: 'select', options: ['upcoming', 'past', 'cancelled'], default: 'upcoming' },
      { name: 'published', label: 'Show on website', type: 'boolean', default: 1 },
    ],
  },
  winners: {
    label: 'Winners',
    singular: 'winner',
    permission: 'manage_winners',
    public: true,
    orderBy: { column: 'awarded_on', ascending: false },
    secondaryOrderBy: { column: 'id', ascending: false },
    fields: [
      { name: 'name', label: 'Winner', type: 'text', required: true },
      { name: 'competition', label: 'Competition', type: 'text' },
      { name: 'position', label: 'Position', type: 'text' },
      { name: 'awarded_on', label: 'Date', type: 'date' },
      { name: 'photo', label: 'Photograph', type: 'image' },
      { name: 'entry_title', label: 'Entry title', type: 'text' },
      { name: 'note', label: 'Note', type: 'textarea' },
      { name: 'published', label: 'Show on website', type: 'boolean', default: 1 },
    ],
  },
  achievements: {
    label: 'Achievements',
    singular: 'achievement',
    permission: 'manage_achievements',
    public: true,
    orderBy: { column: 'achieved_on', ascending: false },
    secondaryOrderBy: { column: 'id', ascending: false },
    fields: [
      { name: 'title', label: 'Achievement', type: 'text', required: true },
      { name: 'holder', label: 'Achieved by', type: 'text' },
      { name: 'achieved_on', label: 'Date', type: 'date' },
      { name: 'photo', label: 'Image', type: 'image' },
      { name: 'detail', label: 'Detail', type: 'textarea' },
      { name: 'published', label: 'Show on website', type: 'boolean', default: 1 },
    ],
  },
  week_stars: {
    label: 'Week Stars',
    singular: 'Week Star',
    permission: 'manage_week_stars',
    public: true,
    orderBy: { column: 'week_of', ascending: false },
    secondaryOrderBy: { column: 'id', ascending: false },
    fields: [
      { name: 'name', label: 'Week Star', type: 'text', required: true },
      { name: 'week_of', label: 'Week beginning', type: 'date', required: true },
      { name: 'photo', label: 'Photograph', type: 'image' },
      { name: 'reason', label: 'Why they were chosen', type: 'textarea' },
      { name: 'course', label: 'Course / year', type: 'text' },
      { name: 'published', label: 'Show on website', type: 'boolean', default: 1 },
    ],
  },
  star_members: {
    label: 'Star Members',
    singular: 'Star Member',
    permission: 'manage_star_members',
    public: true,
    orderBy: { column: 'sort_order', ascending: true },
    secondaryOrderBy: { column: 'id', ascending: false },
    fields: [
      { name: 'name', label: 'Star Member', type: 'text', required: true },
      { name: 'photo', label: 'Photograph', type: 'image' },
      { name: 'course', label: 'Course / year', type: 'text' },
      { name: 'citation', label: 'Citation', type: 'textarea' },
      { name: 'sort_order', label: 'Display order', type: 'number', default: 0 },
      { name: 'published', label: 'Show on website', type: 'boolean', default: 1 },
    ],
  },
  gallery: {
    label: 'Gallery',
    singular: 'photograph',
    permission: 'manage_gallery',
    public: true,
    orderBy: { column: 'taken_on', ascending: false },
    secondaryOrderBy: { column: 'id', ascending: false },
    fields: [
      { name: 'image', label: 'Photograph', type: 'image', required: true },
      { name: 'caption', label: 'Caption', type: 'text' },
      { name: 'credit', label: 'Photograph by', type: 'text' },
      { name: 'album', label: 'Album', type: 'text' },
      { name: 'taken_on', label: 'Date taken', type: 'date' },
      { name: 'published', label: 'Show on website', type: 'boolean', default: 1 },
    ],
  },
  pages: {
    label: 'Pages',
    singular: 'page',
    permission: 'manage_pages',
    public: true,
    orderBy: { column: 'slug', ascending: true },
    fields: [
      { name: 'slug', label: 'Address (slug)', type: 'text', required: true },
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'body', label: 'Content', type: 'textarea' },
      { name: 'published', label: 'Show on website', type: 'boolean', default: 1 },
    ],
  },
  statistics: {
    label: 'Statistics',
    singular: 'statistic',
    permission: 'manage_statistics',
    public: true,
    orderBy: { column: 'sort_order', ascending: true },
    secondaryOrderBy: { column: 'id', ascending: false },
    fields: [
      { name: 'label', label: 'Label', type: 'text', required: true },
      { name: 'value', label: 'Value', type: 'text', required: true },
      { name: 'sort_order', label: 'Display order', type: 'number', default: 0 },
      { name: 'published', label: 'Show on website', type: 'boolean', default: 1 },
    ],
  },
};

const now = () => new Date().toISOString();

function getClient() {
  if (!supabase) {
    const err = new Error('Database client not configured. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment.');
    err.statusCode = 500;
    throw err;
  }
  return supabase;
}

module.exports = {
  get supabase() { return getClient(); },
  now,
  PERMISSIONS,
  SUPER_ONLY_PERMISSIONS,
  DEFAULT_ADMIN_PERMISSIONS,
  RESOURCES,
};
