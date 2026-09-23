// src/routes/faculty.js

const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { UPLOAD_DIR } = require('../utils/upload');

const router = express.Router();

router.use(requireRole('faculty'));

function loadOwnedAssignment(facultyId, assignmentId) {
  return db
    .prepare('SELECT * FROM assignments WHERE id = ? AND faculty_id = ?')
    .get(assignmentId, facultyId);
}

router.get('/dashboard', (req, res) => {
  const facultyId = req.session.user.id;

  const assignments = db.prepare(
    `SELECT a.*,
       (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id) AS submission_count
     FROM assignments a
     WHERE a.faculty_id = ?
     ORDER BY a.created_at DESC`
  ).all(facultyId);

  const totalStudents = db
    .prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'student' AND status = 'active'")
    .get().c;

  const totalAssignments = assignments.length;

  const totalSubmissions = assignments.reduce(
    (sum, a) => sum + a.submission_count,
    0
  );

  const totalPossible = totalAssignments * totalStudents;

  const pendingSubmissions = Math.max(
    totalPossible - totalSubmissions,
    0
  );

  res.render('faculty-dashboard', {
    user: req.session.user,
    assignments,
    stats: {
      totalAssignments,
      totalSubmissions,
      pendingSubmissions
    }
  });
});

// New assignment form
router.get('/assignments/new', (req, res) => {
  res.render('faculty-new-assignment', {
    user: req.session.user,
    error: null,
    csrfToken: req.session.csrfToken,
    values: {}
  });
});

router.post('/assignments', (req, res) => {
  const {
    title,
    description,
    course_name,
    deadline,
    allowed_file_types,
    max_file_size_mb,
    _csrf
  } = req.body;

  if (_csrf !== req.session.csrfToken) {
    return res.status(403).render('faculty-new-assignment', {
      user: req.session.user,
      error: 'Invalid form submission, please try again.',
      csrfToken: req.session.csrfToken,
      values: req.body
    });
  }

  if (!title || !course_name || !deadline) {
    return res.status(400).render('faculty-new-assignment', {
      user: req.session.user,
      error: 'Title, course, and deadline are required.',
      csrfToken: req.session.csrfToken,
      values: req.body
    });
  }

  const maxBytes =
    Math.max(1, Number(max_file_size_mb) || 10) * 1024 * 1024;

  const types = (allowed_file_types || 'pdf')
    .split(',')
    .map((t) => t.trim().toLowerCase().replace('.', ''))
    .filter(Boolean)
    .join(',');

  const info = db.prepare(
    `INSERT INTO assignments (title, description, course_name, faculty_id, deadline, allowed_file_types, max_file_size)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    title.trim(),
    (description || '').trim(),
    course_name.trim(),
    req.session.user.id,
    new Date(deadline).toISOString(),
    types || 'pdf',
    maxBytes
  );

  res.redirect(`/faculty/assignments/${info.lastInsertRowid}`);
});

router.get('/assignments/:id', (req, res) => {
  const assignment = loadOwnedAssignment(
    req.session.user.id,
    req.params.id
  );

  if (!assignment) {
    return res.status(404).render('error', {
      title: 'Not found',
      message: 'Assignment not found.',
      user: req.session.user
    });
  }

  const filter =
    req.query.filter === 'submitted' ||
    req.query.filter === 'not_submitted'
      ? req.query.filter
      : 'all';

  const search = (req.query.q || '').trim();

  const students = db.prepare(
    `SELECT u.id, u.name, u.student_id, u.email,
            s.id AS submission_id, s.submitted_at, s.file_original_name
     FROM users u
     LEFT JOIN submissions s ON s.student_id = u.id AND s.assignment_id = ?
     WHERE u.role = 'student' AND u.status = 'active'
     ORDER BY u.name ASC`
  ).all(assignment.id);

  let filtered = students;

  if (filter === 'submitted') {
    filtered = filtered.filter((s) => s.submission_id);
  }

  if (filter === 'not_submitted') {
    filtered = filtered.filter((s) => !s.submission_id);
  }

  if (search) {
    const q = search.toLowerCase();

    filtered = filtered.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.student_id || '').toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q)
    );
  }

  res.render('faculty-assignment', {
    user: req.session.user,
    assignment,
    students: filtered,
    filter,
    search,
    submittedCount: students.filter((s) => s.submission_id).length,
    totalCount: students.length,
    csrfToken: req.session.csrfToken
  });
});

router.post('/assignments/:id/close', (req, res) => {
  const assignment = loadOwnedAssignment(
    req.session.user.id,
    req.params.id
  );

  if (!assignment) {
    return res.status(404).render('error', {
      title: 'Not found',
      message: 'Assignment not found.',
      user: req.session.user
    });
  }

  if (req.body._csrf !== req.session.csrfToken) {
    return res.status(403).send('Invalid form submission.');
  }

  const newStatus =
    assignment.status === 'open' ? 'closed' : 'open';

  db.prepare(
    "UPDATE assignments SET status = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(newStatus, assignment.id);

  res.redirect(`/faculty/assignments/${assignment.id}`);
});

router.get('/submissions/:id/download', (req, res) => {
  const submission = db
    .prepare('SELECT * FROM submissions WHERE id = ?')
    .get(req.params.id);

  if (!submission) {
    return res.status(404).render('error', {
      title: 'Not found',
      message: 'Submission not found.',
      user: req.session.user
    });
  }

  
  const assignment = loadOwnedAssignment(
    req.session.user.id,
    submission.assignment_id
  );

  if (!assignment) {
    return res.status(403).render('error', {
      title: 'Not allowed',
      message: 'You do not have access to this submission.',
      user: req.session.user
    });
  }

  const filePath = path.join(
    UPLOAD_DIR,
    submission.file_storage_name
  );

  if (!fs.existsSync(filePath)) {
    return res.status(404).render('error', {
      title: 'Not found',
      message: 'File is missing from storage.',
      user: req.session.user
    });
  }

  res.download(filePath, submission.file_original_name);
});

module.exports = router;