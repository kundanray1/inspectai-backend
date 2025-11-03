const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/ApiError');
const Subscription = require('../models/subscription.model');

const getSubscription = catchAsync(async (req, res) => {
  const { organizationId } = req.params;
  const requesterOrg = req.user ? req.user.organizationId : undefined;
  if (requesterOrg && requesterOrg !== organizationId) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
  }

  const subscription = await Subscription.findOne({ organizationId }).lean();

  if (!subscription) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Subscription not found');
  }

  res.send({ data: subscription });
});

const upsertSubscription = catchAsync(async (req, res) => {
  const { organizationId } = req.params;
  const requesterOrg = req.user ? req.user.organizationId : undefined;
  if (requesterOrg && requesterOrg !== organizationId) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
  }

  const subscription = await Subscription.findOneAndUpdate(
    { organizationId },
    { $set: req.body },
    { new: true, upsert: true }
  ).lean();

  res.status(httpStatus.CREATED).send({ data: subscription });
});

const upgradeSubscription = catchAsync(async (req, res) => {
  const { organizationId } = req.params;
  const requesterOrg = req.user ? req.user.organizationId : undefined;
  if (requesterOrg && requesterOrg !== organizationId) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
  }

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

module.exports = {
  getSubscription,
  upsertSubscription,
  upgradeSubscription,
};
