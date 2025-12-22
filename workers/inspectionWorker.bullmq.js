/**
 * Inspection Worker (BullMQ)
 * 
 * Background worker for processing inspection jobs using BullMQ.
 * Replaces the RabbitMQ-based inspectionWorker.js
 * 
 * @module workers/inspectionWorker.bullmq
 */

/* eslint-disable no-console */
const logger = require('../src/config/logger');
const { startInspectionWorker } = require('../src/queues/inspection.bullmq');
const { shutdown } = require('../src/queues/queue.config');
const { jobService, reportPresetService } = require('../src/services');
const { Inspection } = require('../src/models/inspection.model');

/**
 * Process an inspection job
 * @param {Object} params - Job parameters
 * @param {string} params.jobId - Database job ID
 * @param {string} params.inspectionId - Inspection ID
 * @param {string} params.organizationId - Organization ID
 * @param {Object} params.payload - Job payload
 * @param {Function} params.updateProgress - Progress update function
 * @returns {Promise<Object>}
 */
const processInspectionJob = async ({ jobId, inspectionId, organizationId, payload, updateProgress }) => {
  try {
    logger.info({ jobId, inspectionId }, 'Inspection worker picked up job');

    // Update job status to processing
    await jobService.updateJobProgress({
      jobId,
      status: 'processing',
      progress: 5,
      message: 'Inspection processing started',
    });

    // Fetch inspection
    const inspection = await Inspection.findOne({
      _id: inspectionId,
      organizationId,
    }).lean();

    if (!inspection) {
      throw new Error('Inspection not found for job');
    }

    await updateProgress(10, 'Inspection loaded');

    // Find report preset
    let preset = null;
    if (payload.reportPresetId) {
      preset = await reportPresetService
        .getPresetById({ presetId: payload.reportPresetId, organizationId })
        .catch(() => null);
    }

    if (!preset && inspection.reportPresetId) {
      preset = await reportPresetService
        .getPresetById({ presetId: inspection.reportPresetId, organizationId })
        .catch(() => null);
    }

    if (!preset) {
      preset = await reportPresetService.getDefaultPreset({ organizationId });
    }

    if (!preset) {
      throw new Error('No report preset available for organization');
    }

    await updateProgress(15, 'Report preset loaded');

    // Process images/rooms
    const images = Array.isArray(payload && payload.images) ? payload.images : [];
    const rooms = inspection.rooms || [];
    const totalUnits = (payload && payload.totalUnits) || images.length || rooms.length || 1;

    for (let index = 0; index < totalUnits; index += 1) {
      const progress = Math.min(95, Math.round(((index + 1) / totalUnits) * 80) + 15);

      // TODO: Integrate with Gemini AI service for actual analysis
      // For now, simulate processing
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, 100));

      // eslint-disable-next-line no-await-in-loop
      await updateProgress(progress, `Processed unit ${index + 1}/${totalUnits}`);

      // eslint-disable-next-line no-await-in-loop
      await jobService.updateJobProgress({
        jobId,
        processedUnits: index + 1,
        totalUnits,
        progress,
        message: `Processed chunk ${index + 1}/${totalUnits}`,
      });
    }

    // Generate result
    const result = {
      summary: 'Inspection analysis completed.',
      metrics: {
        processedUnits: totalUnits,
        roomsAnalyzed: rooms.length,
        imagesProcessed: images.length,
      },
      reportPresetId: preset._id,
      schemaVersion:
        preset.versions && preset.versions.length > 0
          ? preset.versions[preset.versions.length - 1].version
          : 1,
      schema: preset.schema,
    };

    // Mark job as completed
    await jobService.markJobCompleted({
      jobId,
      result,
      message: 'Inspection analysis completed',
    });

    await updateProgress(100, 'Inspection processing complete');

    logger.info({ jobId, inspectionId }, 'Inspection job completed successfully');
    return result;
  } catch (error) {
    logger.error({ err: error, jobId }, 'Inspection worker encountered an error');

    await jobService.markJobFailed({ jobId, error });
    throw error;
  }
};

// Start the worker
const worker = startInspectionWorker(processInspectionJob);

logger.info('Inspection worker (BullMQ) started and awaiting jobs');

// Graceful shutdown handlers
const gracefulShutdown = async (signal) => {
  logger.info({ signal }, 'Inspection worker received shutdown signal');

  try {
    await worker.close();
    await shutdown();
    logger.info('Inspection worker shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Error during shutdown');
    process.exit(1);
  }
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error({ error }, 'Uncaught exception in worker');
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'Unhandled rejection in worker');
});

