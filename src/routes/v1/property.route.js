const express = require('express');
const auth = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const propertyController = require('../../controllers/property.controller');
const propertyValidation = require('../../validations/property.validation');

const router = express.Router();

router
  .route('/')
  .get(auth(), propertyController.listProperties)
  .post(auth(), validate(propertyValidation.createProperty), propertyController.createProperty);

router
  .route('/:id')
  .get(auth(), propertyController.getProperty)
  .patch(auth(), validate(propertyValidation.updateProperty), propertyController.updateProperty);

module.exports = router;
