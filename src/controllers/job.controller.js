const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { jobService } = require('../services');
const inspectionQueue = require('../queues/inspection.bullmq');
const { getQueueStats, healthCheck } = require('../queues/queue.config');

const listInspectionJobs = catchAsync(async (req, res) => {
  const jobs = await jobService.listJobsForInspection({
    inspectionId: req.params.inspectionId,
    organizationId: req.user ? req.user.organizationId : undefined,
  });
  res.send({ data: jobs });
});

const getJob = catchAsync(async (req, res) => {
  const job = await jobService.getJobById(req.params.jobId);
  res.send({ data: job });
});

const createJob = catchAsync(async (req, res) => {
  const { inspectionId } = req.params;
  const job = await jobService.createJob({
    inspectionId,
    organizationId: req.user.organizationId,
    type: req.body.type,
    roomId: req.body.roomId,
    payload: req.body.payload,
    totalUnits: req.body.totalUnits,
    createdBy: req.user.id,
  });

  const queueResult = await inspectionQueue.publishInspectionJob({
    jobId: job._id.toString(),
    inspectionId: job.inspectionId.toString(),
    organizationId: job.organizationId.toString(),
    payload: req.body.payload || {},
  });

  res.status(httpStatus.CREATED).send({
    data: {
      ...job,
      queueDepth: queueResult.queueDepth,
    },
  });
});

const updateJob = catchAsync(async (req, res) => {
  const job = await jobService.updateJobProgress({
    jobId: req.params.jobId,
    processedUnits: req.body.processedUnits,
    totalUnits: req.body.totalUnits,
    progress: req.body.progress,
    status: req.body.status,
    message: req.body.message,
    metadata: req.body.metadata,
  });
  res.send({ data: job });
});

/**
 * Get queue status (for debugging/monitoring)
 */
const getQueueStatus = catchAsync(async (req, res) => {
  const [inspectionStats, redisHealthy] = await Promise.all([
    getQueueStats('inspection-process'),
    healthCheck(),
  ]);

  res.send({
    data: {
      redisConnected: redisHealthy,
      queues: {
        'inspection-process': inspectionStats,
      },
    },
  });
});

module.exports = {
  listInspectionJobs,
  getJob,
  createJob,
  updateJob,
  getQueueStatus,
};
