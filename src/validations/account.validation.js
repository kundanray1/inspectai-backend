const Joi = require('joi');

const updatePreferences = {
  body: Joi.object()
    .keys({
      marketingEmails: Joi.boolean(),
      productUpdates: Joi.boolean(),
      newsletter: Joi.boolean(),
      reminders: Joi.boolean(),
    })
    .min(1)
    .required(),
};

const updateOnboarding = {
  body: Joi.object()
    .keys({
      completed: Joi.boolean(),
      step: Joi.number().integer().min(0),
      version: Joi.number().integer().min(1),
      lastInspectionId: Joi.string().hex().length(24),
      lastSeenAt: Joi.date().iso(),
    })
    .min(1)
    .required(),
};

module.exports = {
  updatePreferences,
  updateOnboarding,
};
