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

const createPlan = {
  body: Joi.object()
    .keys({
      slug: Joi.string().trim(),
      name: Joi.string().required(),
      description: Joi.string().allow('', null),
      priceMonthly: Joi.number().allow(null),
      currency: Joi.string().default('usd'),
      reportLimit: Joi.number().integer().min(0).default(0),
      features: Joi.array().items(Joi.string()).default([]),
      stripePriceId: Joi.string().allow('', null),
      trialDays: Joi.number().integer().min(0).default(0),
      isPublic: Joi.boolean().default(false),
      isCustom: Joi.boolean().default(false),
      organizationId: Joi.string().allow('', null),
      active: Joi.boolean().default(true),
    })
    .required(),
};

const assignPlan = {
  params: Joi.object().keys({
    planId: Joi.string().required(),
  }),
  body: Joi.object()
    .keys({
      organizationId: Joi.string().required(),
    })
    .required(),
};

module.exports = {
  listAdminUsers,
  updateSetting,
  createPlan,
  assignPlan,
};
