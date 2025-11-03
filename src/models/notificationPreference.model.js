const mongoose = require('mongoose');

const notificationPreferenceSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, required: true },
    marketingEmails: { type: Boolean, default: true },
    productUpdates: { type: Boolean, default: true },
    newsletter: { type: Boolean, default: true },
    reminders: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const NotificationPreference = mongoose.model('NotificationPreference', notificationPreferenceSchema);

module.exports = NotificationPreference;
