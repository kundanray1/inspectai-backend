const Joi = require('joi');

const listAdminUsers = {
  query: Joi.object().keys({
    email: Joi.string().allow('', null),
    status: Joi.string().allow('', null),
    isAdmin: Joi.string().valid('true', 'false', 'both').default('both'),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(10),
  }),
};

const updateSetting = {
  params: Joi.object().keys({
    key: Joi.string().required(),
  }),
  body: Joi.object().unknown(true).required(),
};

module.exports = {
  listAdminUsers,
  updateSetting,
};
