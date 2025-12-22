const Joi = require('joi');
const { objectId } = require('./custom.validation');

const schemaShape = Joi.object().min(1);

const schemaField = Joi.alternatives().try(schemaShape, Joi.string());

const tagsField = Joi.alternatives().try(Joi.array().items(Joi.string()), Joi.string());

const booleanField = Joi.alternatives().try(
  Joi.boolean(),
  Joi.string().valid('true', 'false', '1', '0', 'yes', 'no', 'on', 'off')
);

const createPreset = {
  body: Joi.object()
    .keys({
      name: Joi.string().required(),
      description: Joi.string().allow('', null),
      schema: schemaField,
      tags: tagsField,
      isDefault: booleanField,
    })
    .required(),
};

const updatePreset = {
  params: Joi.object().keys({
    presetId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      name: Joi.string(),
      description: Joi.string().allow('', null),
      schema: schemaField,
      tags: tagsField,
      isDefault: booleanField,
    })
    .min(1)
    .required(),
};

const getPreset = {
  params: Joi.object().keys({
    presetId: Joi.string().custom(objectId).required(),
  }),
};

const deletePreset = getPreset;

module.exports = {
  createPreset,
  updatePreset,
  getPreset,
  deletePreset,
};
