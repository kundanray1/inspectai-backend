const path = require('path');
const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/ApiError');
const config = require('../config/config');
const { Inspection } = require('../models/inspection.model');
const logger = require('../config/logger');
const { jobService, reportPresetService } = require('../services');
const inspectionQueue = require('../queues/inspection.queue');

const uploadPhotos = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { roomId } = req.body;
  const files = Array.isArray(req.files) ? req.files : [];

  if (!files.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'At least one photo is required');
  }

  if (files.length > 50) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'A maximum of 50 photos can be uploaded at once');
  }

  if (!roomId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'roomId is required to attach photos');
  }

  if (!req.user) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Authentication required');
  }

  const inspection = await Inspection.findOne({ _id: id, organizationId: req.user.organizationId });
  if (!inspection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Inspection not found');
  }

  const room = inspection.rooms.id(roomId);
  if (!room) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Room not found');
  }

  const newPhotos = files.map((file) => {
    const photo = room.photos.create({
      storagePath: path.join(config.uploads.dir, file.filename),
      originalFilename: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
    });
    room.photos.push(photo);
    return photo;
  });

  let preset = null;
  if (inspection.reportPresetId) {
    preset = await reportPresetService
      .getPresetById({
        presetId: inspection.reportPresetId,
        organizationId: req.user.organizationId,
      })
      .catch(() => null);
  }

  if (!preset) {
    preset = await reportPresetService.getDefaultPreset({ organizationId: req.user.organizationId });
    if (preset && !inspection.reportPresetId) {
      inspection.reportPresetId = preset._id;
    }
  }

  if (!preset) {
    throw new ApiError(httpStatus.UNPROCESSABLE_ENTITY, 'No report preset configured for this organization');
  }

  inspection.markModified('rooms');
  await inspection.save();

  logger.info(`Uploaded ${files.length} photos to inspection ${id}`);

  const job = await jobService.createJob({
    inspectionId: inspection._id,
    organizationId: req.user.organizationId,
    type: 'inspection.analysis',
    roomId,
    payload: {
      photoIds: newPhotos.map((photo) => photo._id),
      inspectionId: inspection._id,
      roomId,
    },
    totalUnits: files.length,
    createdBy: req.user.id,
  });

  let queueResult;
  let queuedJob;
  try {
    queueResult = await inspectionQueue.publishInspectionJob({
      job,
      payload: {
        jobId: job._id,
        inspectionId: inspection._id,
        roomId,
        photoIds: newPhotos.map((photo) => photo._id),
        reportPresetId: inspection.reportPresetId,
      },
    });
    queuedJob = await jobService.getJobById(job._id);
  } catch (error) {
    await jobService.markJobFailed({ jobId: job._id, error });
    throw error;
  }

  res.status(httpStatus.CREATED).send({
    data: {
      photos: room.photos,
      job: {
        id: job._id,
        status: queuedJob.status,
        progress: queuedJob.progress,
        queueDepth: queueResult.queueDepth,
      },
    },
  });
});

module.exports = {
  uploadPhotos,
};
