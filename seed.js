

const bcrypt = require('bcryptjs');
const db = require('./db');

function upsertUser({ name, email, student_id, password, role }) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  const password_hash = bcrypt.hashSync(password, 10);

  if (existing) {
    db.prepare(
      `UPDATE users SET name = ?, student_id = ?, password_hash = ?, role = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(name, student_id || null, password_hash, role, existing.id);
    return existing.id;
  }

  const info = db.prepare(
    `INSERT INTO users (name, email, student_id, password_hash, role)
     VALUES (?, ?, ?, ?, ?)`
  ).run(name, email, student_id || null, password_hash, role);
  return info.lastInsertRowid;
}

const facultyId = upsertUser({
  name: 'Dr. Pollob Das',
  email: 'faculty@example.com',
  student_id: null,
  password: 'faculty123',
  role: 'faculty',
});

upsertUser({
  name: 'Sam Student',
  email: 'student@example.com',
  student_id: 'STU-1001',
  password: 'student123',
  role: 'student',
});

upsertUser({
  name: 'Priya Student',
  email: 'student2@example.com',
  student_id: 'STU-1002',
  password: 'student123',
  role: 'student',
});


const assignmentCount = db.prepare('SELECT COUNT(*) AS c FROM assignments').get().c;
if (assignmentCount === 0) {
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

  db.prepare(
    `INSERT INTO assignments (title, description, course_name, faculty_id, deadline, allowed_file_types, max_file_size)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('Assignment 01: Intro Report', 'Write a short report on the topic covered in week 1.', 'CSE101', facultyId, future, 'pdf,doc,docx', 10485760);

  db.prepare(
    `INSERT INTO assignments (title, description, course_name, faculty_id, deadline, allowed_file_types, max_file_size)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('Assignment 00: Warm-up (closed)', 'Practice assignment, deadline has passed.', 'CSE101', facultyId, past, 'pdf,doc,docx', 10485760);
}

console.log('Seed complete.');
console.log('Faculty login : faculty@example.com / faculty123');
console.log('Student login : student@example.com / student123');
console.log('Student login : student2@example.com / student123');
