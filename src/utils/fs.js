/* eslint-disable security/detect-non-literal-fs-filename */
const fs = require('fs');

const ensureDirSync = (dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
};

module.exports = {
  ensureDirSync,
};
