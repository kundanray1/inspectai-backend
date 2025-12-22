/**
 * Inspection Queue (BullMQ)
 * 
 * Job queue for processing inspection analysis jobs.
 * Replaces the RabbitMQ-based inspection.queue.js
 * 
 * @module queues/inspection.bullmq
 */

const { QUEUE_NAMES, createQueue, createWorker, addJob, getQueueStats } = require('./queue.config');
const config = require('../config/config');
const logger = require('../config/logger');

/**
 * Job types for inspection processing
 */
const JOB_TYPES = {
  ANALYZE_PHOTOS: 'analyze-photos',
  PROCESS_INSPECTION: 'process-inspection',
  GENERATE_ROOM_SUMMARY: 'generate-room-summary',
};

/**
 * Initialize the inspection queue
 * @returns {import('bullmq').Queue}
 */
const initQueue = () => {
  return createQueue(QUEUE_NAMES.INSPECTION_PROCESS, {
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
      priority: 1,
    },
  });
};

/**
 * Add an inspection processing job
 * @param {Object} params - Job parameters
 * @param {string} params.jobId - Database job ID
 * @param {string} params.inspectionId - Inspection ID
 * @param {string} params.organizationId - Organization ID
 * @param {Object} [params.payload] - Additional payload
 * @param {Object} [params.options] - Job options
 * @returns {Promise<import('bullmq').Job>}
 */
const publishInspectionJob = async ({ jobId, inspectionId, organizationId, payload = {}, options = {} }) => {
  const queue = initQueue();
  
  // Check queue depth before adding
  const stats = await getQueueStats(QUEUE_NAMES.INSPECTION_PROCESS);
  const maxPending = config.queues.inspection.maxPending || 500;
  
  if (stats.total >= maxPending) {
    logger.warn({ queueDepth: stats.total, maxPending }, 'Inspection queue saturated');
    const error = new Error('Inspection queue is busy, please retry later');
    error.statusCode = 503;
    throw error;
  }

  const job = await addJob(
    QUEUE_NAMES.INSPECTION_PROCESS,
    JOB_TYPES.PROCESS_INSPECTION,
    {
      jobId,
      inspectionId,
      organizationId,
      payload,
      queuedAt: new Date().toISOString(),
    },
    {
      jobId: `inspection-${jobId}`, // Use consistent job ID for deduplication
      priority: options.priority || 1,
      ...options,
    }
  );

  logger.info({ bullmqJobId: job.id, jobId, inspectionId, queueDepth: stats.total + 1 }, 'Inspection job published');

  return {
    bullmqJobId: job.id,
    jobId,
    queueDepth: stats.total + 1,
  };
};

/**
 * Start the inspection worker
 * @param {Function} handler - Job processor function
 * @param {Object} [options] - Worker options
 * @returns {import('bullmq').Worker}
 */
const startInspectionWorker = (handler, options = {}) => {
  const concurrency = options.concurrency || config.queues.inspection.concurrency || 2;
  
  const worker = createWorker(
    QUEUE_NAMES.INSPECTION_PROCESS,
    async (job) => {
      const { jobId, inspectionId, organizationId, payload } = job.data;

      logger.info({ bullmqJobId: job.id, jobId, inspectionId }, 'Processing inspection job');

      // Track progress
      await job.updateProgress(5);

      try {
        const result = await handler({
          jobId,
          inspectionId,
          organizationId,
          payload,
          updateProgress: async (progress, message) => {
            await job.updateProgress(progress);
            await job.log(message || `Progress: ${progress}%`);
          },
        });

        await job.updateProgress(100);
        return result;
      } catch (error) {
        logger.error({ bullmqJobId: job.id, jobId, error: error.message }, 'Inspection job failed');
        throw error;
      }
    },
    {
      concurrency,
      limiter: {
        max: 10,
        duration: 60000, // 10 jobs per minute max (for rate limiting external APIs)
      },
      ...options,
    }
  );

  logger.info({ concurrency }, 'Inspection worker started');
  return worker;
};

/**
 * Get current queue depth
 * @returns {Promise<Object>}
 */
const checkQueueDepth = async () => {
  return getQueueStats(QUEUE_NAMES.INSPECTION_PROCESS);
};

/**
 * Drain the queue (for testing)
 * @returns {Promise<void>}
 */
const drainQueue = async () => {
  const queue = initQueue();
  await queue.drain();
  logger.info('Inspection queue drained');
};

module.exports = {
  JOB_TYPES,
  initQueue,
  publishInspectionJob,
  startInspectionWorker,
  checkQueueDepth,
  drainQueue,
};

