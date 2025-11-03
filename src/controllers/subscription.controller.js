const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/ApiError');
const Subscription = require('../models/subscription.model');
const config = require('../config/config');
const { billingService } = require('../services');

const ensureOrgAccess = (req, organizationId) => {
  const requesterOrg = req.user ? req.user.organizationId : undefined;
  if (requesterOrg && requesterOrg !== organizationId) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
  }
};

const listPlans = catchAsync(async (req, res) => {
  const organizationId = req.user ? req.user.organizationId : null;
  const plans = await billingService.listPlans(organizationId);
  res.send({ data: plans });
});

const getSubscription = catchAsync(async (req, res) => {
  const { organizationId } = req.params;
  ensureOrgAccess(req, organizationId);

  const subscription = await Subscription.findOne({ organizationId }).lean();

  if (!subscription) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Subscription not found');
  }

  res.send({ data: subscription });
});

const upsertSubscription = catchAsync(async (req, res) => {
  const { organizationId } = req.params;
  ensureOrgAccess(req, organizationId);

  const subscription = await Subscription.findOneAndUpdate(
    { organizationId },
    { $set: req.body },
    { new: true, upsert: true }
  ).lean();

  res.status(httpStatus.CREATED).send({ data: subscription });
});

const upgradeSubscription = catchAsync(async (req, res) => {
  const { organizationId } = req.params;
  ensureOrgAccess(req, organizationId);

  const subscription = await Subscription.findOneAndUpdate(
    { organizationId },
    {
      $set: {
        plan: 'pro',
        status: 'active',
        reportLimit: 20,
        trialEndsAt: undefined,
      },
    },
    { new: true }
  ).lean();

  if (!subscription) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Subscription not found');
  }

  res.send({ data: subscription });
});

const checkout = catchAsync(async (req, res) => {
  const { organizationId } = req.params;
  ensureOrgAccess(req, organizationId);

  if (!req.user) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Authentication required');
  }

  const defaultReturnUrl = config.stripe && config.stripe.returnUrl ? config.stripe.returnUrl : undefined;
  const cancelUrl = req.body && req.body.cancelUrl ? req.body.cancelUrl : defaultReturnUrl;

  const url = await billingService.createCheckoutSession({
    organizationId,
    customerEmail: req.user.email,
    customerName: req.user.name,
    priceId: req.body.priceId,
    cancelUrl,
  });

  res.status(httpStatus.CREATED).send({ url });
});

const openPortal = catchAsync(async (req, res) => {
  const { organizationId } = req.params;
  ensureOrgAccess(req, organizationId);

  const defaultReturnUrl = config.stripe && config.stripe.returnUrl ? config.stripe.returnUrl : undefined;
  const portalReturnUrl = req.body && req.body.returnUrl ? req.body.returnUrl : defaultReturnUrl;

  const url = await billingService.createBillingPortalSession({
    organizationId,
    returnUrl: portalReturnUrl,
  });

  res.send({ url });
});

const cancelSubscription = catchAsync(async (req, res) => {
  const { organizationId } = req.params;
  ensureOrgAccess(req, organizationId);

  const subscription = await billingService.cancelStripeSubscription({ organizationId });

  res.send({ data: subscription });
});

const resumeSubscription = catchAsync(async (req, res) => {
  const { organizationId } = req.params;
  ensureOrgAccess(req, organizationId);

  const subscription = await billingService.resumeStripeSubscription({ organizationId });

  res.send({ data: subscription });
});

module.exports = {
  listPlans,
  getSubscription,
  upsertSubscription,
  upgradeSubscription,
  checkout,
  openPortal,
  cancelSubscription,
  resumeSubscription,
};
