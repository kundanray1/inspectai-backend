const Joi = require('joi');
const { objectId } = require('./custom.validation');

const schemaShape = Joi.object().min(1);

const createPreset = {
  body: Joi.object()
    .keys({
      name: Joi.string().required(),
      description: Joi.string().allow('', null),
      schema: schemaShape,
      tags: Joi.array().items(Joi.string()).default([]),
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
      schema: schemaShape,
      tags: Joi.array().items(Joi.string()),
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
