const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { notificationService, userService } = require('../services');

const getNotificationPreferences = catchAsync(async (req, res) => {
  if (!req.user) {
    res.status(httpStatus.UNAUTHORIZED).send({ message: 'Authentication required' });
    return;
  }

  const prefs = await notificationService.getPreferencesForUser(req.user.id);
  res.send({ data: prefs });
});

const updateNotificationPreferences = catchAsync(async (req, res) => {
  if (!req.user) {
    res.status(httpStatus.UNAUTHORIZED).send({ message: 'Authentication required' });
    return;
  }

  const prefs = await notificationService.updatePreferencesForUser(req.user.id, req.body);
  res.send({ data: prefs });
});

const getOnboarding = catchAsync(async (req, res) => {
  if (!req.user) {
    res.status(httpStatus.UNAUTHORIZED).send({ message: 'Authentication required' });
    return;
  }

  const user = await userService.getUserById(req.user.id);
  res.send({ data: user?.onboarding || {} });
});

const updateOnboarding = catchAsync(async (req, res) => {
  if (!req.user) {
    res.status(httpStatus.UNAUTHORIZED).send({ message: 'Authentication required' });
    return;
  }

  const user = await userService.getUserById(req.user.id);
  const current = user?.onboarding ? user.onboarding.toObject ? user.onboarding.toObject() : user.onboarding : {};
  const next = {
    ...current,
    ...req.body,
    lastSeenAt: new Date(),
  };

  if (req.body.completed === true) {
    next.completedAt = new Date();
  }

  const updated = await userService.updateUserById(req.user.id, { onboarding: next });
  res.send({ data: updated.onboarding });
});

module.exports = {
  getNotificationPreferences,
  updateNotificationPreferences,
  getOnboarding,
  updateOnboarding,
};
