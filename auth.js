// src/routes/auth.js

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect(
      req.session.user.role === 'faculty'
        ? '/faculty/dashboard'
        : '/student/dashboard'
    );
  }

  res.render('login', {
    error: null,
    csrfToken: req.session.csrfToken
  });
});

router.post('/login', (req, res) => {
  const { email, password, _csrf } = req.body;

  if (_csrf !== req.session.csrfToken) {
    return res.status(403).render('login', {
      error: 'Invalid form submission, please try again.',
      csrfToken: req.session.csrfToken
    });
  }

  if (!email || !password) {
    return res.status(400).render('login', {
      error: 'Email and password are required.',
      csrfToken: req.session.csrfToken
    });
  }

  const user = db
    .prepare('SELECT * FROM users WHERE email = ?')
    .get(email.trim().toLowerCase());

  const genericError = 'Invalid email or password.';

  if (!user || user.status !== 'active') {
    return res.status(401).render('login', {
      error: genericError,
      csrfToken: req.session.csrfToken
    });
  }

  const ok = bcrypt.compareSync(password, user.password_hash);

  if (!ok) {
    return res.status(401).render('login', {
      error: genericError,
      csrfToken: req.session.csrfToken
    });
  }

  // Regenerate the session on login to prevent session fixation.
  req.session.regenerate((err) => {
    if (err) {
      return res.status(500).render('login', {
        error: 'Something went wrong, please try again.',
        csrfToken: req.session.csrfToken
      });
    }

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      student_id: user.student_id,
      role: user.role
    };

    res.redirect(
      user.role === 'faculty'
        ? '/faculty/dashboard'
        : '/student/dashboard'
    );
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

router.get('/api/auth/me', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      error: 'Not authenticated'
    });
  }

  res.json({
    user: req.session.user
  });
});

module.exports = router;