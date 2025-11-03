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

module.exports = {
  updatePreferences,
};
