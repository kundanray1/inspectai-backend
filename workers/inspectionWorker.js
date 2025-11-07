/* eslint-disable no-console */
const logger = require('../src/config/logger');
const { consumeInspectionJobs } = require('../src/queues/inspection.queue');
const { jobService, reportPresetService } = require('../src/services');
const { Inspection } = require('../src/models/inspection.model');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const processInspectionJob = async (message, { ack, nack }) => {
  const { jobId, payload } = message;
  try {
    logger.info({ jobId }, 'Inspection worker picked up job');
    await jobService.updateJobProgress({
      jobId,
      status: 'processing',
      progress: 5,
      message: 'Inspection processing started',
    });

    const inspection = await Inspection.findOne({
      _id: payload.inspectionId,
      organizationId: message.organizationId,
    }).lean();

    if (!inspection) {
      throw new Error('Inspection not found for job');
    }

    let preset = null;
    if (payload.reportPresetId) {
      preset = await reportPresetService
        .getPresetById({ presetId: payload.reportPresetId, organizationId: message.organizationId })
        .catch(() => null);
    }

    if (!preset && inspection.reportPresetId) {
      preset = await reportPresetService
        .getPresetById({ presetId: inspection.reportPresetId, organizationId: message.organizationId })
        .catch(() => null);
    }

    if (!preset) {
      preset = await reportPresetService.getDefaultPreset({ organizationId: message.organizationId });
    }

    if (!preset) {
      throw new Error('No report preset available for organization');
    }

    const images = Array.isArray(payload && payload.images) ? payload.images : [];
    const totalUnits = (payload && payload.totalUnits) || images.length || 1;

    for (let index = 0; index < totalUnits; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(100);
      const progress = Math.min(95, Math.round(((index + 1) / totalUnits) * 90) + 5);
      // eslint-disable-next-line no-await-in-loop
      await jobService.updateJobProgress({
        jobId,
        processedUnits: index + 1,
        totalUnits,
        progress,
        message: `Processed chunk ${index + 1}/${totalUnits}`,
      });
    }

    // TODO: Integrate Ollama + report generation. For now, return stub result.
    const result = {
      summary: 'Inspection analysis completed (stub result).',
      metrics: {
        processedUnits: totalUnits,
      },
      reportPresetId: preset._id,
      schemaVersion: preset.versions && preset.versions.length > 0 ? preset.versions[preset.versions.length - 1].version : 1,
      schema: preset.schema,
    };

    await jobService.markJobCompleted({ jobId, result, message: 'Inspection analysis completed' });
    ack();
  } catch (error) {
    logger.error({ err: error, jobId }, 'Inspection worker encountered an error');
    await jobService.markJobFailed({ jobId, error });
    nack({ requeue: false });
  }
};

consumeInspectionJobs(processInspectionJob)
  .then(() => {
    logger.info('Inspection worker started and awaiting jobs');
  })
  .catch((error) => {
    logger.error({ err: error }, 'Failed to start inspection worker');
    process.exit(1);
  });

process.on('SIGINT', () => {
  logger.info('Inspection worker received SIGINT, exiting');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Inspection worker received SIGTERM, exiting');
  process.exit(0);
});
