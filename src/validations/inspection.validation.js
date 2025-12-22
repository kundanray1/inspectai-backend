const Joi = require('joi');
const { objectId } = require('./custom.validation');

const listInspections = {
  query: Joi.object().keys({
    status: Joi.string().valid('draft', 'in_progress', 'completed'),
    propertyId: Joi.string(),
  }),
};

const createInspection = {
  body: Joi.object()
    .keys({
      propertyId: Joi.string().required(),
      scheduledFor: Joi.date().iso().optional(),
      reportPresetId: Joi.string().custom(objectId),
      rooms: Joi.array()
        .items(
          Joi.object().keys({
            name: Joi.string().required(),
            displayOrder: Joi.number().integer().optional(),
          })
        )
        .optional(),
    })
    .required(),
};

const updateInspection = {
  body: Joi.object()
    .keys({
      status: Joi.string().valid('draft', 'in_progress', 'completed'),
      scheduledFor: Joi.date().iso(),
      startedAt: Joi.date().iso(),
      completedAt: Joi.date().iso(),
      summary: Joi.string().allow('', null),
      aiSummary: Joi.string().allow('', null),
      reportPresetId: Joi.string().custom(objectId),
    })
    .min(1),
};

const addRoom = {
  body: Joi.object().keys({
    name: Joi.string().required(),
    displayOrder: Joi.number().integer().optional(),
  }),
};

const updateRoom = {
  body: Joi.object()
    .keys({
      name: Joi.string(),
      displayOrder: Joi.number().integer(),
      conditionRating: Joi.string().valid('excellent', 'good', 'fair', 'needs_maintenance'),
      notes: Joi.string().allow('', null),
      actions: Joi.array().items(Joi.string()),
      aiSummary: Joi.string().allow('', null),
    })
    .min(1),
};

const analyseRoom = {
  body: Joi.object().keys({
    observations: Joi.array().items(Joi.string()).default([]),
  }),
};

const uploadPhotos = {
  body: Joi.object().keys({
    // roomId is optional - if not provided, AI will classify the photo into rooms
    roomId: Joi.string().custom(objectId).optional(),
  }),
};

const getUploadUrls = {
  body: Joi.object().keys({
    files: Joi.array()
      .items(
        Joi.object().keys({
          filename: Joi.string().required(),
          contentType: Joi.string().default('image/jpeg'),
        })
      )
      .min(1)
      .max(50)
      .required(),
  }),
};

const registerPhotos = {
  body: Joi.object().keys({
    roomId: Joi.string().custom(objectId).optional(),
    photos: Joi.array()
      .items(
        Joi.object().keys({
          key: Joi.string().required(),
          filename: Joi.string().required(),
          fileSize: Joi.number().integer().min(0).optional(),
          contentType: Joi.string().default('image/jpeg'),
        })
      )
      .min(1)
      .max(50)
      .required(),
  }),
};

module.exports = {
  listInspections,
  createInspection,
  updateInspection,
  addRoom,
  updateRoom,
  analyseRoom,
  uploadPhotos,
  getUploadUrls,
  registerPhotos,
};
