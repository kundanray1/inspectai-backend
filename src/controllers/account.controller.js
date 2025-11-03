const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { notificationService } = require('../services');

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

module.exports = {
  getNotificationPreferences,
  updateNotificationPreferences,
};
