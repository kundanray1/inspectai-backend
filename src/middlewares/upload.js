const multer = require('multer');
const path = require('path');
const config = require('../config/config');
const { ensureDirSync } = require('../utils/fs');

const uploadDir = path.resolve(process.cwd(), config.uploads.dir || 'backend/uploads');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureDirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/\s+/g, '-');
    cb(null, `${timestamp}-${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 50,
  },
});

module.exports = {
  upload,
};
