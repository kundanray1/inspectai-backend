const NotificationPreference = require('../models/notificationPreference.model');

const getPreferencesForUser = async (userId) => {
  const existing = await NotificationPreference.findOne({ userId });
  if (existing) {
    return existing.toObject();
  }
  const created = await NotificationPreference.create({ userId });
  return created.toObject();
};

const updatePreferencesForUser = async (userId, updates) => {
  const prefs = await NotificationPreference.findOneAndUpdate({ userId }, { $set: updates }, { new: true, upsert: true });
  return prefs.toObject();
};

module.exports = {
  getPreferencesForUser,
  updatePreferencesForUser,
};
