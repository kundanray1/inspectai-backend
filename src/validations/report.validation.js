const Joi = require('joi');

const generateReport = {
  body: Joi.object().keys({
    title: Joi.string().allow('', null),
    summary: Joi.string().allow('', null),
    introduction: Joi.string().allow('', null),
    conclusion: Joi.string().allow('', null),
  }),
};

const generatePdf = {
  body: Joi.object().keys({
    version: Joi.number().integer().min(1),
  }),
};

module.exports = {
  generateReport,
  generatePdf,
};
