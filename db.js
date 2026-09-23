

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
require('dotenv').config();

const DB_FILE = process.env.DB_FILE || './data/app.db';

// Make sure the folder for the db file exists
fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  student_id    TEXT UNIQUE,           -- NULL for faculty
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('student', 'faculty')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assignments (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  title              TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  course_name        TEXT NOT NULL,
  faculty_id         INTEGER NOT NULL REFERENCES users(id),
  deadline           TEXT NOT NULL,      -- ISO datetime string
  allowed_file_types TEXT NOT NULL DEFAULT 'pdf,doc,docx',
  max_file_size      INTEGER NOT NULL DEFAULT 10485760,
  status             TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS submissions (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  assignment_id      INTEGER NOT NULL REFERENCES assignments(id),
  student_id         INTEGER NOT NULL REFERENCES users(id),
  file_original_name TEXT NOT NULL,
  file_storage_name  TEXT NOT NULL,
  file_type          TEXT NOT NULL,
  file_size          INTEGER NOT NULL,
  submitted_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (assignment_id, student_id)   -- one active submission per student per assignment
);

CREATE INDEX IF NOT EXISTS idx_assignments_faculty ON assignments(faculty_id);
CREATE INDEX IF NOT EXISTS idx_submissions_assignment ON submissions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_submissions_student ON submissions(student_id);
`);

module.exports = db;
