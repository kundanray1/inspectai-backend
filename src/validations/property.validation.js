const Joi = require('joi');

const addressSchema = Joi.object().keys({
  line1: Joi.string().required(),
  line2: Joi.string().allow('', null),
  city: Joi.string().required(),
  state: Joi.string().required(),
  postcode: Joi.string().required(),
  country: Joi.string().default('Australia'),
});

const createProperty = {
  body: Joi.object()
    .keys({
      name: Joi.string().required(),
      referenceCode: Joi.string().allow('', null),
      address: addressSchema.required(),
      metadata: Joi.object().unknown(true),
    })
    .required(),
};

const updateProperty = {
  body: Joi.object()
    .keys({
      name: Joi.string(),
      referenceCode: Joi.string().allow('', null),
      address: addressSchema,
      metadata: Joi.object().unknown(true),
    })
    .min(1),
};

module.exports = {
  createProperty,
  updateProperty,
};
