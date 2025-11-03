const Joi = require('joi');

const generateReport = {
  body: Joi.object().keys({
    introduction: Joi.string().allow('', null),
    conclusion: Joi.string().allow('', null),
  }),
};

module.exports = {
  generateReport,
};
