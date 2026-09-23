# Assignment Submission System (MVP)

A small, secure assignment submission system for students and faculty.
Built deliberately simple: one backend, server-rendered pages, one file
database. No frontend framework, no build step, no separate API server —
the fewer moving parts, the fewer things to break or explain.

## Stack, and why

| Piece | Choice | Why |
|---|---|---|
| Server | Node.js + Express | Minimal, extremely common, easy to extend |
| Views | EJS (server-rendered HTML) | No build step, no client framework, no bundler — you edit an `.ejs` file and refresh the page |
| Database | SQLite via `better-sqlite3` | Single file, zero setup (no separate DB server to install/run), synchronous API keeps route code readable |
| Auth | `express-session` + `bcryptjs` | Cookie-based sessions are the simplest correct approach for a server-rendered app; bcrypt is the standard for password hashing |
| File upload | `multer` | The standard, well-audited Express upload middleware |
| Security headers | `helmet` | One line to get sane default HTTP security headers |

This is a monolith on purpose. Section 13 of the spec sketches a REST API;
the routes here follow that same shape (`/student/...`, `/faculty/...`,
plus `GET /api/auth/me`) so it's a small step to split the backend into a
pure JSON API later if a separate frontend (React, mobile app, etc.) is
ever needed — the database layer and business rules in `src/routes/*.js`
would not need to change, only how they respond.

## Project structure

```
assignment-submission-system/
├── src/
│   ├── app.js              # Express app setup, middleware, route mounting
│   ├── db.js               # SQLite connection + schema (source of truth for tables)
│   ├── seed.js             # Creates demo faculty/student accounts + sample assignments
│   ├── middleware/
│   │   └── auth.js         # requireAuth / requireRole (role-based access control)
│   ├── routes/
│   │   ├── auth.js         # /login, /logout, /api/auth/me
│   │   ├── student.js      # student dashboard, view/submit assignment, download own file
│   │   └── faculty.js      # faculty dashboard, create/close assignment, view/download submissions
│   └── utils/
│       └── upload.js       # multer config: safe generated filenames, storage outside /public
├── views/                  # EJS templates (server-rendered pages)
├── public/css/style.css    # Single stylesheet, no framework
├── uploads/                # Uploaded files live here — never served statically
├── data/                   # SQLite database file lives here
├── .env.example
└── package.json
```

## Setup

Requires Node.js 18+.

```bash
cd assignment-submission-system
npm install
cp .env.example .env
npm run seed     # creates demo faculty + student accounts and sample assignments
npm start
```

Then open **http://localhost:3000**.

### Demo accounts (created by `npm run seed`)

| Role | Email | Password |
|---|---|---|
| Faculty | faculty@example.com | faculty123 |
| Student | student@example.com | student123 |
| Student | student2@example.com | student123 |

Registration is intentionally disabled for the MVP, per the spec — accounts
are created via the seed script, standing in for an admin-managed process.
To add more, edit `src/seed.js` and run `npm run seed` again (it's safe to
re-run; it upserts by email).

## Core workflow (what to try first)

1. Log in as faculty → **New assignment** → create one with a near-future deadline.
2. Log out, log in as a student → open the assignment → upload a file → submit.
3. Log back in as faculty → open the assignment → see the student listed as
   submitted, with a working **Download** link. Other students show as
   "Not submitted."

## Security notes (what's implemented and why)

- **Passwords**: hashed with bcrypt (`bcryptjs`, cost factor 10), never stored or returned in plain text.
- **Sessions**: `httpOnly`, `SameSite=Lax` cookies; session is regenerated on login to prevent session fixation.
- **CSRF**: every state-changing form includes a per-session random token, checked on the server before any write. Combined with `SameSite=Lax` this covers the MVP without adding another dependency.
- **Role-based access control**: `requireRole('student'|'faculty')` middleware guards every route under `/student` and `/faculty`. A student hitting a faculty URL (or vice versa) gets a 403, not a redirect loop or leaked data.
- **Ownership checks**: a student can only see/download their own submissions; a faculty member can only manage assignments they created and can only download submissions belonging to those assignments (checked server-side on every request, not just hidden in the UI).
- **File upload safety**:
  - The original filename is never trusted for storage — a random name (`timestamp-uuid.ext`) is generated server-side.
  - Files are stored in `/uploads`, outside `/public`, so they are never reachable by static file serving — the only way to get a file is through an authenticated, authorized download route.
  - File type is validated server-side against the assignment's `allowed_file_types`, and file size against its `max_file_size` (uploads that fail these checks are deleted immediately).
- **SQL injection**: all queries use parameterized statements (`better-sqlite3`'s `?` placeholders) — no string concatenation into SQL, anywhere.
- **XSS**: EJS escapes all `<%= %>` output by default; no `<%- %>` (raw/unescaped) is used for anything that comes from user input.
- **Deadlines**: submissions are blocked server-side once `deadline` has passed or the assignment is closed, regardless of what the client sends.
- **Errors**: a centralized error handler renders a generic message and logs the real error server-side — stack traces are never sent to the client.

## Database schema

See `src/db.js` for the full `CREATE TABLE` statements (this is the single
source of truth). Summary:

- **users** — `id, name, email (unique), student_id (unique, nullable), password_hash, role, status, created_at, updated_at`
- **assignments** — `id, title, description, course_name, faculty_id (FK), deadline, allowed_file_types, max_file_size, status, created_at, updated_at`
- **submissions** — `id, assignment_id (FK), student_id (FK), file_original_name, file_storage_name, file_type, file_size, submitted_at, updated_at`, with a **unique constraint on `(assignment_id, student_id)`** — a student has at most one submission row per assignment; resubmitting updates that row (and deletes the old file) instead of creating a new one.

## Routes

Server-rendered pages (what a browser actually visits):

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET/POST | `/login` | anyone | Log in |
| POST | `/logout` | any logged-in user | Log out |
| GET | `/student/dashboard` | student | Dashboard: stats + assignment list |
| GET | `/student/assignments/:id` | student | View one assignment, submit/resubmit |
| POST | `/student/assignments/:id/submit` | student | Handle the file upload |
| GET | `/student/submissions/:id/download` | student (own only) | Download own submitted file |
| GET | `/faculty/dashboard` | faculty | Dashboard: stats + own assignments |
| GET/POST | `/faculty/assignments/new`, `/faculty/assignments` | faculty | Create an assignment |
| GET | `/faculty/assignments/:id` | faculty (owner only) | Submission list, search/filter |
| POST | `/faculty/assignments/:id/close` | faculty (owner only) | Close/reopen an assignment |
| GET | `/faculty/submissions/:id/download` | faculty (owner only) | Download a student's file |

A small JSON endpoint is also included for future frontend/mobile use:
`GET /api/auth/me` → `{ user }` or `401`.

## What's deliberately left out of the MVP (and how to add it later)

The schema and route structure leave room for all of these without a
rewrite:

- **Admin role** — add `'admin'` to the `role` CHECK constraint and a new `requireRole('admin')` route group.
- **Password reset / email verification** — add a `password_resets` table and a mail-sending util; the `users` table already has `status` for account activation/deactivation.
- **Multiple faculty per course / course management** — introduce a `courses` table and a `course_faculty` join table; `assignments.course_name` becomes `course_id`.
- **Grading, feedback, rubrics** — add a `grade`, `feedback` column (or a separate `grades` table) referencing `submissions.id`.
- **Multiple files per submission / resubmission history** — change the unique constraint and add a `submission_files` child table instead of storing one file per submission row.
- **Notifications, deadline reminders** — a background job reading `assignments.deadline` and `users.email`.
- **CSV/Excel export, audit logs, cloud storage** — additive: a new route for export, a new `audit_log` table, or swapping `UPLOAD_DIR` for an S3 client in `src/utils/upload.js`.

None of these require touching the authentication, authorization, or core
submission workflow already in place.
