const Joi = require('joi');

const upsertSubscription = {
  body: Joi.object()
    .keys({
      plan: Joi.string().valid('starter', 'pro', 'enterprise').required(),
      status: Joi.string().valid('trialing', 'active', 'past_due', 'canceled').required(),
      reportLimit: Joi.number().integer().min(0).required(),
      seats: Joi.number().integer().min(1).optional(),
      trialEndsAt: Joi.date().iso().allow(null),
      stripeCustomerId: Joi.string().optional(),
      stripeSubscriptionId: Joi.string().allow('', null),
      usage: Joi.array().items(
        Joi.object().keys({
          periodStart: Joi.date().iso().required(),
          periodEnd: Joi.date().iso().required(),
          totalReports: Joi.number().integer().min(0).required(),
          totalPdfExports: Joi.number().integer().min(0).required(),
        })
      ),
    })
    .required(),
};

const checkoutSession = {
  body: Joi.object()
    .keys({
      priceId: Joi.string().required(),
      cancelUrl: Joi.string().uri().allow(null, ''),
    })
    .required(),
};

const billingPortal = {
  body: Joi.object()
    .keys({
      returnUrl: Joi.string().uri().allow(null, ''),
    })
    .optional(),
};

module.exports = {
  upsertSubscription,
  checkoutSession,
  billingPortal,
};
