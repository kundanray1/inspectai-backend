const express = require('express');
const auth = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const subscriptionController = require('../../controllers/subscription.controller');
const subscriptionValidation = require('../../validations/subscription.validation');

const router = express.Router();

router.get('/:organizationId', auth(), subscriptionController.getSubscription);

router.put(
  '/:organizationId',
  auth(),
  validate(subscriptionValidation.upsertSubscription),
  subscriptionController.upsertSubscription
);

router.post('/:organizationId/upgrade', auth(), subscriptionController.upgradeSubscription);

module.exports = router;
