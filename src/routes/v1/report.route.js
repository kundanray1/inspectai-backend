const express = require('express');
const auth = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const reportController = require('../../controllers/report.controller');
const reportValidation = require('../../validations/report.validation');
const { requireSubscriptionOrTrial } = require('../../middlewares/subscriptionGate');

const router = express.Router();

/**
 * @swagger
 * /reports:
 *   get:
 *     summary: List all reports for the organization
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *         description: Items per page
 */
router.get('/', auth(), reportController.listReports);

/**
 * @swagger
 * /reports/inspection/{inspectionId}:
 *   get:
 *     summary: Get report by inspection ID
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 */
router.get('/inspection/:inspectionId', auth(), reportController.getReportByInspection);

/**
 * @swagger
 * /reports/inspection/{inspectionId}:
 *   post:
 *     summary: Create a new report for an inspection
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 */
router.post(
  '/inspection/:inspectionId',
  auth(),
  validate(reportValidation.generateReport),
  reportController.createReport
);

/**
 * @swagger
 * /reports/{reportId}/download:
 *   get:
 *     summary: Download report PDF (presigned URL)
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:reportId/download', auth(), reportController.downloadReportPDF);

/**
 * @swagger
 * /reports/{reportId}/generate-pdf:
 *   post:
 *     summary: Generate or regenerate report PDF
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 *     description: Generates a branded PDF. Trial users get watermarked reports.
 */
router.post(
  '/:reportId/generate-pdf',
  auth(),
  requireSubscriptionOrTrial,
  reportController.generateReportPDF
);

/**
 * @swagger
 * /reports/{reportId}/preview:
 *   get:
 *     summary: Preview report PDF (streamed)
 *     tags: [Reports]
 *     security:
 *       - bearerAuth: []
 */
router.get('/:reportId/preview', auth(), reportController.previewReportPDF);

module.exports = router;
