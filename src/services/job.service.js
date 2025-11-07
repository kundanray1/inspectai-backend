const mongoose = require('mongoose');
const httpStatus = require('http-status');
const { Job } = require('../models');
const ApiError = require('../utils/ApiError');
const { emitInspectionEvent } = require('../lib/socket');

const toJobObject = (jobDoc) => {
  if (!jobDoc) return null;
  const job = jobDoc.toObject ? jobDoc.toObject() : jobDoc;
  if (job.inspectionId) {
    job.inspectionId = job.inspectionId.toString();
  }
  if (job.roomId) {
    job.roomId = job.roomId.toString();
  }
  return job;
};

const emitJobEvent = (jobDoc, event) => {
  const job = toJobObject(jobDoc);
  if (!job) {
    return;
  }
  emitInspectionEvent(job.inspectionId, event, job);
};

const createJob = async ({ inspectionId, organizationId, type, roomId, payload, totalUnits = 0, createdBy }) => {
  const jobDoc = await Job.create({
    inspectionId: mongoose.Types.ObjectId(inspectionId),
    organizationId,
    type,
    roomId: roomId ? mongoose.Types.ObjectId(roomId) : undefined,
    payload,
    totalUnits,
    events: [
      {
        type: 'job.created',
        message: 'Job created',
        progress: 0,
      },
    ],
    createdBy,
  });
  const job = jobDoc.toObject();
  emitJobEvent(job, 'job.created');
  return job;
};

const getJobById = async (jobId) => {
  const job = await Job.findById(jobId).lean();
  if (!job) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Job not found');
  }
  return job;
};

const listJobsForInspection = async ({ inspectionId, organizationId }) => {
  const filter = { inspectionId: mongoose.Types.ObjectId(inspectionId) };
  if (organizationId) {
    filter.organizationId = organizationId;
  }
  const jobs = await Job.find(filter).sort({ createdAt: -1 }).lean();
  return jobs;
};

const appendJobEvent = async ({ jobId, type, message, progress, metadata }) => {
  const job = await Job.findByIdAndUpdate(
    jobId,
    {
      $push: {
        events: {
          type,
          message,
          progress,
          metadata,
        },
      },
    },
    { new: true }
  ).lean();
  if (!job) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Job not found');
  }
  emitJobEvent(job, 'job.updated');
  return job;
};

const updateJobProgress = async ({ jobId, processedUnits, totalUnits, progress, status, message, metadata }) => {
  const updateSet = {};
  if (typeof processedUnits === 'number') {
    updateSet.processedUnits = processedUnits;
  }
  if (typeof totalUnits === 'number') {
    updateSet.totalUnits = totalUnits;
  }
  if (typeof progress === 'number') {
    updateSet.progress = Math.max(0, Math.min(100, progress));
  }
  if (status) {
    updateSet.status = status;
    if (status === 'processing') {
      updateSet.startedAt = new Date();
    }
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      updateSet.completedAt = new Date();
    }
  }

  const updateDoc = { $set: updateSet };

  if (message) {
    updateDoc.$push = {
      events: {
        type: 'job.update',
        message,
        progress: typeof updateSet.progress === 'number' ? updateSet.progress : undefined,
        metadata,
      },
    };
  }

  const job = await Job.findByIdAndUpdate(jobId, updateDoc, { new: true }).lean();

  if (!job) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Job not found');
  }
  emitJobEvent(job, 'job.updated');
  return job;
};

const markJobCompleted = async ({ jobId, result, message }) => {
  await updateJobProgress({
    jobId,
    status: 'completed',
    progress: 100,
    message: message || 'Job completed successfully',
  });
  await Job.findByIdAndUpdate(jobId, { $set: { result } });
  const job = await Job.findById(jobId).lean();
  emitJobEvent(job, 'job.completed');
  return job;
};

const markJobFailed = async ({ jobId, error }) => {
  const message = typeof error === 'string' ? error : error.message;
  const metadata = typeof error === 'object' ? { error } : undefined;
  const job = await Job.findByIdAndUpdate(
    jobId,
    {
      $set: {
        status: 'failed',
        completedAt: new Date(),
        lastError: message,
      },
      $push: {
        events: {
          type: 'job.failed',
          message,
          metadata,
        },
      },
    },
    { new: true }
  ).lean();

  if (!job) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Job not found');
  }
  emitJobEvent(job, 'job.failed');
  return job;
};

const markJobQueued = async ({ jobId, queueDepth }) => {
  const metadata = typeof queueDepth === 'number' ? { queueDepth } : undefined;
  const job = await updateJobProgress({
    jobId,
    status: 'queued',
    message: 'Job queued',
    metadata,
  });
  emitJobEvent(job, 'job.queued');
  return job;
};

module.exports = {
  createJob,
  getJobById,
  listJobsForInspection,
  appendJobEvent,
  updateJobProgress,
  markJobCompleted,
  markJobFailed,
  markJobQueued,
};
