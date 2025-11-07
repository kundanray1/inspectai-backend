const Joi = require('joi');
const { objectId } = require('./custom.validation');

const jobType = Joi.string().valid('inspection.analysis', 'inspection.report', 'inspection.llm', 'inspection.email');
const jobStatus = Joi.string().valid('pending', 'queued', 'processing', 'completed', 'failed', 'cancelled');

const listInspectionJobs = {
  params: Joi.object().keys({
    inspectionId: Joi.string().custom(objectId).required(),
  }),
};

const createJob = {
  params: Joi.object().keys({
    inspectionId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      roomId: Joi.string().custom(objectId),
      type: jobType.required(),
      totalUnits: Joi.number().integer().min(0),
      payload: Joi.object(),
    })
    .required(),
};

const getJob = {
  params: Joi.object().keys({
    jobId: Joi.string().custom(objectId).required(),
  }),
};

const updateJob = {
  params: Joi.object().keys({
    jobId: Joi.string().custom(objectId).required(),
  }),
  body: Joi.object()
    .keys({
      processedUnits: Joi.number().integer().min(0),
      totalUnits: Joi.number().integer().min(0),
      progress: Joi.number().min(0).max(100),
      status: jobStatus,
      message: Joi.string(),
      metadata: Joi.object(),
    })
    .min(1)
    .required(),
};

module.exports = {
  listInspectionJobs,
  createJob,
  getJob,
  updateJob,
};
