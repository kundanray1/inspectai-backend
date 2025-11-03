const express = require('express');
const auth = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const subscriptionController = require('../../controllers/subscription.controller');
const subscriptionValidation = require('../../validations/subscription.validation');

const router = express.Router();

router.get('/plans', auth(), subscriptionController.listPlans);
router.get('/:organizationId', auth(), subscriptionController.getSubscription);

router.put(
  '/:organizationId',
  auth(),
  validate(subscriptionValidation.upsertSubscription),
  subscriptionController.upsertSubscription
);

router.post('/:organizationId/upgrade', auth(), subscriptionController.upgradeSubscription);
router.post(
  '/:organizationId/checkout',
  auth(),
  validate(subscriptionValidation.checkoutSession),
  subscriptionController.checkout
);
router.post(
  '/:organizationId/portal',
  auth(),
  validate(subscriptionValidation.billingPortal),
  subscriptionController.openPortal
);
router.post('/:organizationId/cancel', auth(), subscriptionController.cancelSubscription);
router.post('/:organizationId/resume', auth(), subscriptionController.resumeSubscription);

module.exports = router;
