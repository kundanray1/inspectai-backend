const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/ApiError');
const Report = require('../models/report.model');
const { generateReport } = require('../services/report.service');

const getReportByInspection = catchAsync(async (req, res) => {
  const { inspectionId } = req.params;
  const orgId = req.user ? req.user.organizationId : undefined;
  const report = await Report.findOne({ inspectionId, organizationId: orgId }).lean();

  if (!report) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Report not found');
  }

  res.send({ data: report });
});

const createReport = catchAsync(async (req, res) => {
  if (!req.user) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
  }

  const report = await generateReport(req.params.inspectionId, req.user.organizationId, {
    generatedBy: req.user.id,
    introduction: req.body.introduction,
    conclusion: req.body.conclusion,
  });

  res.status(httpStatus.CREATED).send({ data: report });
});

module.exports = {
  getReportByInspection,
  createReport,
};
