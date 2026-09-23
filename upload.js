

const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
require('dotenv').config();

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const HARD_MAX_SIZE = 50 * 1024 * 1024; 

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
    const safeName = `${Date.now()}-${crypto.randomUUID()}${ext}`;
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: HARD_MAX_SIZE },
});

module.exports = { upload, UPLOAD_DIR };
