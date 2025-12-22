const path = require('path');
const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/ApiError');
const config = require('../config/config');
const { Inspection } = require('../models/inspection.model');
const logger = require('../config/logger');
const { jobService, reportPresetService } = require('../services');
const inspectionQueue = require('../queues/inspection.bullmq');

/**
 * Upload photos to an inspection.
 * - If roomId is provided: attach photos to that specific room (legacy behavior)
 * - If roomId is NOT provided: AI will classify photos into rooms automatically
 */
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

  if (!req.user) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Authentication required');
  }

  const inspection = await Inspection.findOne({ _id: id, organizationId: req.user.organizationId });
  if (!inspection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Inspection not found');
  }

  // Ensure report preset is set
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

  // Auto-create a default preset if none exists
  if (!preset) {
    logger.info({ organizationId: req.user.organizationId }, 'No preset found, creating default preset');
    preset = await reportPresetService.createPreset({
      organizationId: req.user.organizationId,
      userId: req.user.id,
      name: 'Default Inspection Report',
      description: 'Auto-generated default preset for property inspections',
      schema: {
        title: 'Property Inspection Report',
        sections: [
          {
            id: 'property_overview',
            name: 'Property Overview',
            description: 'Basic property information',
            order: 1,
            repeatable: false,
            fields: [
              { key: 'property_address', label: 'Property Address', type: 'text', required: true },
              { key: 'inspection_date', label: 'Inspection Date', type: 'date', required: true },
              { key: 'inspector_name', label: 'Inspector Name', type: 'text', required: true },
            ],
          },
          {
            id: 'room_inspection',
            name: 'Room Inspection',
            description: 'Individual room inspections',
            order: 2,
            repeatable: true,
            fields: [
              { key: 'room_name', label: 'Room Name', type: 'text', required: true },
              { key: 'condition_rating', label: 'Condition', type: 'condition_rating', required: true },
              { key: 'photos', label: 'Photos', type: 'image_gallery' },
              { key: 'issues', label: 'Issues Found', type: 'issue_list' },
              { key: 'notes', label: 'Inspector Notes', type: 'textarea' },
            ],
          },
          {
            id: 'summary',
            name: 'Summary & Recommendations',
            description: 'Overall assessment and recommendations',
            order: 3,
            repeatable: false,
            fields: [
              { key: 'overall_condition', label: 'Overall Condition', type: 'condition_rating', required: true },
              { key: 'summary', label: 'Executive Summary', type: 'textarea', required: true },
              { key: 'recommendations', label: 'Recommendations', type: 'textarea' },
            ],
          },
        ],
        styling: {
          headerStyle: 'centered',
          primaryColor: '#1a365d',
          fontFamily: 'Arial',
        },
      },
      isDefault: true,
    });
    inspection.reportPresetId = preset._id;
  }

  let newPhotos = [];
  let targetRoomId = roomId;
  let isAIClassificationMode = false;

  if (roomId) {
    // Legacy mode: attach to specific room
    const room = inspection.rooms.id(roomId);
    if (!room) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Room not found');
    }

    newPhotos = files.map((file) => {
      const photo = room.photos.create({
        storagePath: path.join(config.uploads.dir, file.filename),
        originalFilename: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
      });
      room.photos.push(photo);
      return { photo, roomId: room._id };
    });
  } else {
    // AI Classification mode: create a temporary "Unclassified" room
    // Photos will be moved to proper rooms after AI classification
    isAIClassificationMode = true;
    
    // Create or find the "Pending Classification" room
    let pendingRoom = inspection.rooms.find((r) => r.name === '_pending_classification');
    if (!pendingRoom) {
      inspection.rooms.push({
        name: '_pending_classification',
        displayOrder: 999,
        conditionRating: 'unrated',
        photos: [],
      });
      pendingRoom = inspection.rooms[inspection.rooms.length - 1];
    }

    newPhotos = files.map((file) => {
      const photo = pendingRoom.photos.create({
        storagePath: path.join(config.uploads.dir, file.filename),
        originalFilename: file.originalname,
        fileSize: file.size,
        mimeType: file.mimetype,
        pendingClassification: true, // Mark as needing AI classification
      });
      pendingRoom.photos.push(photo);
      return { photo, roomId: pendingRoom._id };
    });
    
    targetRoomId = pendingRoom._id;
  }

  inspection.markModified('rooms');
  await inspection.save();

  logger.info(`Uploaded ${files.length} photos to inspection ${id} (AI classification: ${isAIClassificationMode})`);

  // Create the analysis job
  const job = await jobService.createJob({
    inspectionId: inspection._id,
    organizationId: req.user.organizationId,
    type: isAIClassificationMode ? 'inspection.classify_and_analyze' : 'inspection.analysis',
    roomId: targetRoomId,
    payload: {
      photoIds: newPhotos.map((p) => p.photo._id),
      inspectionId: inspection._id,
      roomId: targetRoomId,
      aiClassificationMode: isAIClassificationMode,
    },
    totalUnits: files.length,
    createdBy: req.user.id,
  });

  let queueResult;
  let queuedJob;
  try {
    // Mark job as queued first
    await jobService.markJobQueued({ jobId: job._id, queueDepth: 0 });
    
    // Publish to BullMQ queue
    queueResult = await inspectionQueue.publishInspectionJob({
      jobId: job._id.toString(),
      inspectionId: inspection._id.toString(),
      organizationId: req.user.organizationId.toString(),
      payload: {
        roomId: targetRoomId?.toString(),
        photoIds: newPhotos.map((p) => p.photo._id.toString()),
        reportPresetId: inspection.reportPresetId?.toString(),
        aiClassificationMode: isAIClassificationMode,
      },
    });
    queuedJob = await jobService.getJobById(job._id);
  } catch (error) {
    await jobService.markJobFailed({ jobId: job._id, error });
    throw error;
  }

  res.status(httpStatus.CREATED).send({
    data: newPhotos.map((p) => p.photo),
    job: {
      id: job._id,
      status: queuedJob.status,
      progress: queuedJob.progress,
      queueDepth: queueResult.queueDepth,
      aiClassificationMode: isAIClassificationMode,
    },
  });
});

module.exports = {
  uploadPhotos,
};
