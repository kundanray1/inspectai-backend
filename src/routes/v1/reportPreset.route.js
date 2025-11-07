const express = require('express');
const multer = require('multer');
const auth = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const { reportPresetController } = require('../../controllers');
const { reportPresetValidation } = require('../../validations');

const upload = multer({ dest: 'tmp/uploads' });

const router = express.Router();

router
  .route('/')
  .get(auth(), reportPresetController.listPresets)
  .post(
    auth(),
    upload.single('sampleReport'),
    validate(reportPresetValidation.createPreset),
    reportPresetController.createPreset
  );

router
  .route('/:presetId')
  .get(auth(), validate(reportPresetValidation.getPreset), reportPresetController.getPreset)
  .patch(auth(), validate(reportPresetValidation.updatePreset), reportPresetController.updatePreset)
  .delete(auth(), validate(reportPresetValidation.deletePreset), reportPresetController.deletePreset);

module.exports = router;
