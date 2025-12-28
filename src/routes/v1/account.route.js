const express = require('express');
const auth = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const { accountController } = require('../../controllers');
const { accountValidation } = require('../../validations');

const router = express.Router();

router.get('/preferences', auth(), accountController.getNotificationPreferences);
router.put(
  '/preferences',
  auth(),
  validate(accountValidation.updatePreferences),
  accountController.updateNotificationPreferences
);

router.get('/onboarding', auth(), accountController.getOnboarding);
router.patch(
  '/onboarding',
  auth(),
  validate(accountValidation.updateOnboarding),
  accountController.updateOnboarding
);

module.exports = router;
