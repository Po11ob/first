// src/routes/student.js

const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { requireRole } = require('../middleware/auth');
const { upload, UPLOAD_DIR } = require('../utils/upload');

const router = express.Router();

router.use(requireRole('student'));

// Dashboard
router.get('/dashboard', (req, res) => {
  const studentId = req.session.user.id;

  const assignments = db.prepare(
    `SELECT a.*, u.name AS faculty_name,
            s.id AS submission_id, s.submitted_at
     FROM assignments a
     JOIN users u ON u.id = a.faculty_id
     LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
     WHERE a.status = 'open' OR s.id IS NOT NULL
     ORDER BY a.deadline ASC`
  ).all(studentId);

  const total = assignments.length;
  const submitted = assignments.filter((a) => a.submission_id).length;
  const pending = total - submitted;

  res.render('student-dashboard', {
    user: req.session.user,
    assignments,
    stats: {
      total,
      submitted,
      pending
    }
  });
});

// View one assignment
router.get('/assignments/:id', (req, res) => {
  const studentId = req.session.user.id;

  const assignment = db.prepare(
    `SELECT a.*, u.name AS faculty_name FROM assignments a
     JOIN users u ON u.id = a.faculty_id WHERE a.id = ?`
  ).get(req.params.id);

  if (!assignment) {
    return res.status(404).render('error', {
      title: 'Not found',
      message: 'Assignment not found.',
      user: req.session.user
    });
  }

  const submission = db.prepare(
    'SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?'
  ).get(assignment.id, studentId);

  const isPastDeadline =
    new Date(assignment.deadline) < new Date();

  res.render('student-assignment', {
    user: req.session.user,
    assignment,
    submission,
    isPastDeadline,
    canSubmit: assignment.status === 'open' && !isPastDeadline,
    error: null,
    success: req.query.success === '1',
    csrfToken: req.session.csrfToken
  });
});

// Submit / resubmit
router.post('/assignments/:id/submit', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).send(renderUploadError(err));
    }

    next();
  });
}, (req, res) => {
  const studentId = req.session.user.id;

  const assignment = db
    .prepare('SELECT * FROM assignments WHERE id = ?')
    .get(req.params.id);

  const fail = (message) => {
    if (req.file) {
      safeUnlink(path.join(UPLOAD_DIR, req.file.filename));
    }

    return res.status(400).render('student-assignment', {
      user: req.session.user,
      assignment,
      submission: db
        .prepare(
          'SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?'
        )
        .get(assignment.id, studentId),
      isPastDeadline:
        new Date(assignment.deadline) < new Date(),
      canSubmit:
        assignment.status === 'open' &&
        new Date(assignment.deadline) >= new Date(),
      error: message,
      success: false,
      csrfToken: req.session.csrfToken
    });
  };

  if (req.body._csrf !== req.session.csrfToken) {
    return fail('Invalid form submission, please try again.');
  }

  if (!assignment) {
    return res.status(404).render('error', {
      title: 'Not found',
      message: 'Assignment not found.',
      user: req.session.user
    });
  }

  if (assignment.status !== 'open') {
    return fail(
      'This assignment is closed and no longer accepts submissions.'
    );
  }

  if (new Date(assignment.deadline) < new Date()) {
    return fail('The deadline for this assignment has passed.');
  }

  if (!req.file) {
    return fail('Please choose a file to upload.');
  }

  // Server-side file type validation (never trust the client)
  const ext = path.extname(req.file.originalname)
    .toLowerCase()
    .replace('.', '');

  const allowed = assignment.allowed_file_types
    .split(',')
    .map((t) => t.trim().toLowerCase());

  if (!allowed.includes(ext)) {
    return fail(
      `File type ".${ext}" is not allowed. Allowed types: ${assignment.allowed_file_types}`
    );
  }

  // Server-side file size validation against this assignment's own limit
  if (req.file.size > assignment.max_file_size) {
    return fail(
      `File is too large. Maximum size is ${(assignment.max_file_size / (1024 * 1024)).toFixed(1)} MB.`
    );
  }

  const existing = db
    .prepare(
      'SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?'
    )
    .get(assignment.id, studentId);

  if (existing) {
    // Resubmission: replace the stored file and update the record.
    safeUnlink(
      path.join(UPLOAD_DIR, existing.file_storage_name)
    );

    db.prepare(
      `UPDATE submissions SET file_original_name = ?, file_storage_name = ?, file_type = ?, file_size = ?, updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      req.file.originalname,
      req.file.filename,
      ext,
      req.file.size,
      existing.id
    );
  } else {
    db.prepare(
      `INSERT INTO submissions (assignment_id, student_id, file_original_name, file_storage_name, file_type, file_size)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      assignment.id,
      studentId,
      req.file.originalname,
      req.file.filename,
      ext,
      req.file.size
    );
  }

  res.redirect(
    `/student/assignments/${assignment.id}?success=1`
  );
});

// Download own submission
router.get('/submissions/:id/download', (req, res) => {
  const studentId = req.session.user.id;

  const submission = db
    .prepare('SELECT * FROM submissions WHERE id = ?')
    .get(req.params.id);

  if (!submission || submission.student_id !== studentId) {
    return res.status(404).render('error', {
      title: 'Not found',
      message: 'Submission not found.',
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

  res.download(
    filePath,
    submission.file_original_name
  );
});

function safeUnlink(filePath) {
  fs.unlink(filePath, () => {}); // best-effort, ignore errors
}

function renderUploadError(err) {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return 'File is too large.';
  }

  return 'Upload failed. Please try again.';
}

module.exports = router;