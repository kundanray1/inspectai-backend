const express = require('express');
const auth = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const { jobController } = require('../../controllers');
const { jobValidation } = require('../../validations');

const router = express.Router({ mergeParams: true });

router
  .route('/inspection/:inspectionId')
  .get(auth(), validate(jobValidation.listInspectionJobs), jobController.listInspectionJobs)
  .post(auth(), validate(jobValidation.createJob), jobController.createJob);

router
  .route('/:jobId')
  .get(auth(), validate(jobValidation.getJob), jobController.getJob)
  .patch(auth(), validate(jobValidation.updateJob), jobController.updateJob);

module.exports = router;
