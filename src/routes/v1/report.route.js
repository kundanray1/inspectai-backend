const express = require('express');
const auth = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const reportController = require('../../controllers/report.controller');
const reportValidation = require('../../validations/report.validation');

const router = express.Router();

router.get('/inspection/:inspectionId', auth(), reportController.getReportByInspection);

router.post('/inspection/:inspectionId', auth(), validate(reportValidation.generateReport), reportController.createReport);

module.exports = router;
