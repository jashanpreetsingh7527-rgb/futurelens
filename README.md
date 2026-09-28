# FUTURELENS

The club website and its admin area. One Node process, one SQLite file, no npm
dependencies — nothing to install and nothing to compile.

Requires **Node 22.5 or newer** (it uses the built-in `node:sqlite` module).

---

## Running it

```bash
cp .env.example .env          # then edit ADMIN_EMAIL and ADMIN_PASSWORD
node setup.js                 # creates the first Super Admin
node server.js                # http://localhost:3000
```

Then delete `ADMIN_PASSWORD` from `.env`. It is needed exactly once.

Optional, to see the layout with content in it:

```bash
node seed-demo.js
```

- Public site: `http://localhost:3000`
- Admin sign-in: `http://localhost:3000/admin/login.html`

Over plain `http://localhost` keep `SECURE_COOKIES=false` in `.env`, otherwise
the browser will refuse to store the session cookie. In production, serve over
HTTPS and remove that line.

---

## How access works

There are two entirely separate account stores: `admins` and `members`. No code
path moves a row between them. A member cannot become an administrator through
the website, because nothing in the website can create an administrator —
`/api/register` writes to `members` with a hard-coded status and never reads a
role from the request body.

Administrators are created two ways only:

1. `node setup.js`, at deployment, from environment variables.
2. A signed-in Super Admin, at `/admin/administrators.html`.

There is no "register as admin" anywhere, public or otherwise.

### Roles

**Super Admin** — everything, including creating, disabling, removing and
re-rolling other administrators, website settings, and the activity log.

**Admin** — the content and member sections a Super Admin has granted them.

A regular Admin cannot create a Super Admin, change their own role, remove the
Super Admin, or reach settings and the activity log. `manage_administrators` and
`manage_settings` are Super-Admin-only and are stripped from any permission list
submitted for a plain Admin — on write *and* again on read, so a permission that
somehow got into the database still has no effect.

The last active Super Admin cannot be removed, disabled or demoted, and nobody
can disable or delete their own account.

### Where the checks live

Every admin request is authorised on the server, in `routes/admin.js`, against
the session's role and permissions. The frontend hides buttons the user cannot
use; that is presentation only. Hitting the API directly, or typing an admin URL,
gets the same answer:

```
GET /admin/administrators.html   (as a member)  →  302 to the sign-in page
GET /api/admin/administrators    (as an Admin)  →  403
POST /api/admin/content/events   (no permission) →  403
```

Disabling, demoting or changing the permissions of an administrator destroys
their live sessions immediately, so it takes effect on their very next request
rather than at their next sign-in.

### The rest of it

- Passwords hashed with scrypt (`node:crypto`), never stored or displayed in
  plain text. New administrators get a one-time setup link and choose their own
  password; the link is shown to the Super Admin once and expires in 48 hours.
- Session tokens are random 256-bit values in an `HttpOnly`, `SameSite=Lax`,
  `Secure` cookie, stored server-side with an expiry.
- Login rate limiting: 5 failures per IP-and-email within 15 minutes, then a
  lockout. Failed admin sign-ins are recorded in the activity log.
- Uploads are decoded from data URLs, checked by magic bytes as well as MIME
  type, size-capped and written under a generated filename, so an uploaded name
  can never steer a path.
- CSP, `X-Frame-Options`, `nosniff` and an Origin check on every state-changing
  request.
- The activity log is append-only. There is no delete in the UI, no delete in
  the API, and SQLite triggers reject `UPDATE` and `DELETE` on the table
  outright.

---

## Adding a section

Content sections are defined once, in `RESOURCES` in `lib/db.js`. The table, the
validation, the admin editor and the public API are all generated from that
definition. Adding a section means adding one entry and restarting.

```
lib/db.js        schema, resource definitions, permission list
lib/auth.js      hashing, sessions, rate limiting, permission logic
lib/http.js      router, body parsing, cookies, uploads, static files, audit
routes/auth.js   sign-in, registration, invite setup, password change
routes/admin.js  admin management, members, content CRUD, settings, audit
routes/public.js the read-only public API
server.js        server, security headers, admin route gate
setup.js         first Super Admin
public/          the website and the admin panel
data/            SQLite file and uploads (not in version control)
```

## Before it goes live

1. Serve over HTTPS and drop `SECURE_COOKIES=false`.
2. Set `TRUST_PROXY=true` only if you are behind a proxy you control.
3. Remove `ADMIN_PASSWORD` from `.env`.
4. Back up `data/` — it holds the database and every uploaded photograph.
