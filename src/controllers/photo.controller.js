const httpStatus = require('http-status');
const { v4: uuidv4 } = require('uuid');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/ApiError');
const { Inspection } = require('../models/inspection.model');
const logger = require('../config/logger');
const { jobService, reportPresetService } = require('../services');
const inspectionQueue = require('../queues/inspection.bullmq');
const R2Storage = require('../lib/storage/r2.storage');

// Initialize R2 storage
const storage = new R2Storage();

/**
 * Get presigned URLs for uploading photos directly to R2
 * Client will upload directly to R2, then call registerPhotos to save references
 */
const getUploadUrls = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { files } = req.body; // Array of { filename, contentType }

  if (!files || !Array.isArray(files) || files.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'files array is required');
  }

  if (files.length > 50) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Maximum 50 files allowed per request');
  }

  if (!req.user) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Authentication required');
  }

  const inspection = await Inspection.findOne({ _id: id, organizationId: req.user.organizationId });
  if (!inspection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Inspection not found');
  }

  // Generate presigned URLs for each file
  const uploadUrls = await Promise.all(
    files.map(async (file) => {
      const timestamp = Date.now();
      const fileId = uuidv4();
      const safeName = (file.filename || 'photo').replace(/[^a-zA-Z0-9.-]/g, '-');
      const key = storage.buildKey(
        req.user.organizationId,
        `inspections/${inspection._id}/photos/${timestamp}-${fileId}-${safeName}`
      );

      const presignedUrl = await storage.getPresignedUploadUrl(key, {
        contentType: file.contentType || 'image/jpeg',
        expiresIn: 3600, // 1 hour
      });

      return {
        fileId,
        filename: file.filename,
        key,
        uploadUrl: presignedUrl,
        expiresIn: 3600,
      };
    })
  );

  res.status(httpStatus.OK).send({
    data: {
      inspectionId: inspection._id,
      uploads: uploadUrls,
    },
  });
});

/**
 * Register uploaded photos after client uploads directly to R2
 * This saves the photo references and queues AI analysis
 */
const registerPhotos = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { photos, roomId } = req.body;
  // photos: Array of { key, filename, fileSize, contentType }

  if (!photos || !Array.isArray(photos) || photos.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'photos array is required');
  }

  if (photos.length > 50) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Maximum 50 photos allowed per request');
  }

  if (!req.user) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Authentication required');
  }

  const inspection = await Inspection.findOne({ _id: id, organizationId: req.user.organizationId });
  if (!inspection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Inspection not found');
  }

  // Ensure report preset is set
  let preset = await ensurePreset(inspection, req.user);

  let newPhotos = [];
  let targetRoomId = roomId;
  let isAIClassificationMode = false;

  if (roomId) {
    // Legacy mode: attach to specific room
    const room = inspection.rooms.id(roomId);
    if (!room) {
      throw new ApiError(httpStatus.NOT_FOUND, 'Room not found');
    }

    newPhotos = photos.map((p) => {
      const photo = room.photos.create({
        storagePath: p.key,
        thumbnailUrl: storage.getPublicUrl ? storage.getPublicUrl(p.key) : null,
        originalFilename: p.filename,
        fileSize: p.fileSize || 0,
        mimeType: p.contentType || 'image/jpeg',
      });
      room.photos.push(photo);
      return { photo, roomId: room._id };
    });
  } else {
    // AI Classification mode
    isAIClassificationMode = true;

    // Create or find the "Pending Classification" room
    let pendingRoom = inspection.rooms.find((r) => r.name === '_pending_classification');
    if (!pendingRoom) {
      inspection.rooms.push({
        name: '_pending_classification',
        displayOrder: 999,
        conditionRating: 'fair',
        photos: [],
      });
      pendingRoom = inspection.rooms[inspection.rooms.length - 1];
    }

    newPhotos = photos.map((p) => {
      const photo = pendingRoom.photos.create({
        storagePath: p.key,
        thumbnailUrl: storage.getPublicUrl ? storage.getPublicUrl(p.key) : null,
        originalFilename: p.filename,
        fileSize: p.fileSize || 0,
        mimeType: p.contentType || 'image/jpeg',
        pendingClassification: true,
      });
      pendingRoom.photos.push(photo);
      return { photo, roomId: pendingRoom._id };
    });

    targetRoomId = pendingRoom._id;
  }

  inspection.markModified('rooms');
  await inspection.save();

  logger.info(`Registered ${photos.length} photos for inspection ${id} (AI classification: ${isAIClassificationMode})`);

  // Create and queue the analysis job
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
    totalUnits: photos.length,
    createdBy: req.user.id,
  });

  let queueResult = { queueDepth: 0 };
  let queuedJob = job;

  try {
    await jobService.markJobQueued({ jobId: job._id, queueDepth: 0 });

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
    logger.error({ err: error }, 'Failed to queue inspection job');
    await jobService.markJobFailed({ jobId: job._id, error });
    // Don't throw - photos are saved, job just won't process automatically
  }

  res.status(httpStatus.CREATED).send({
    data: newPhotos.map((p) => p.photo),
    job: {
      id: job._id,
      status: queuedJob.status,
      progress: queuedJob.progress,
      queueDepth: queueResult?.queueDepth || 0,
      aiClassificationMode: isAIClassificationMode,
    },
  });
});

/**
 * Legacy upload endpoint - accepts multipart form data
 * For backwards compatibility and simple uploads
 */
const uploadPhotos = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { roomId } = req.body;
  const files = Array.isArray(req.files) ? req.files : [];

  if (!files.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'At least one photo is required');
  }

  if (files.length > 50) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Maximum 50 photos allowed');
  }

  if (!req.user) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Authentication required');
  }

  const inspection = await Inspection.findOne({ _id: id, organizationId: req.user.organizationId });
  if (!inspection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Inspection not found');
  }

  // Ensure report preset
  await ensurePreset(inspection, req.user);

  // Upload files to R2
  const uploadedFiles = await Promise.all(
    files.map(async (file) => {
      const timestamp = Date.now();
      const fileId = uuidv4();
      const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '-');
      const key = storage.buildKey(
        req.user.organizationId,
        `inspections/${inspection._id}/photos/${timestamp}-${fileId}-${safeName}`
      );

      const result = await storage.upload(key, file.buffer, {
        contentType: file.mimetype,
      });

      return {
        key: result.key,
        filename: file.originalname,
        fileSize: file.size,
        contentType: file.mimetype,
      };
    })
  );

  // Use registerPhotos logic
  req.body.photos = uploadedFiles;
  req.body.roomId = roomId;

  // Call the register function with the same request
  return registerPhotos(req, res);
});

/**
 * Helper to ensure inspection has a report preset
 */
async function ensurePreset(inspection, user) {
  let preset = null;

  if (inspection.reportPresetId) {
    preset = await reportPresetService
      .getPresetById({
        presetId: inspection.reportPresetId,
        organizationId: user.organizationId,
      })
      .catch(() => null);
  }

  if (!preset) {
    preset = await reportPresetService.getDefaultPreset({ organizationId: user.organizationId });
    if (preset && !inspection.reportPresetId) {
      inspection.reportPresetId = preset._id;
    }
  }

  if (!preset) {
    logger.info({ organizationId: user.organizationId }, 'Creating default preset');
    preset = await reportPresetService.createPreset({
      organizationId: user.organizationId,
      userId: user.id,
      name: 'Default Inspection Report',
      description: 'Auto-generated default preset',
      schema: {
        title: 'Property Inspection Report',
        sections: [
          {
            id: 'property_overview',
            name: 'Property Overview',
            order: 1,
            repeatable: false,
            fields: [
              { key: 'property_address', label: 'Property Address', type: 'text', required: true },
              { key: 'inspection_date', label: 'Inspection Date', type: 'date', required: true },
            ],
          },
          {
            id: 'room_inspection',
            name: 'Room Inspection',
            order: 2,
            repeatable: true,
            fields: [
              { key: 'room_name', label: 'Room Name', type: 'text', required: true },
              { key: 'condition_rating', label: 'Condition', type: 'condition_rating' },
              { key: 'photos', label: 'Photos', type: 'image_gallery' },
              { key: 'issues', label: 'Issues', type: 'issue_list' },
            ],
          },
          {
            id: 'summary',
            name: 'Summary',
            order: 3,
            repeatable: false,
            fields: [
              { key: 'overall_condition', label: 'Overall Condition', type: 'condition_rating' },
              { key: 'recommendations', label: 'Recommendations', type: 'textarea' },
            ],
          },
        ],
        styling: { primaryColor: '#1a365d', fontFamily: 'Arial' },
      },
      isDefault: true,
    });
    inspection.reportPresetId = preset._id;
  }

  return preset;
}

/**
 * Get presigned download URL for a photo
 */
const getPhotoUrl = catchAsync(async (req, res) => {
  const { id: inspectionId, photoId } = req.params;

  const inspection = await Inspection.findOne({ _id: inspectionId, organizationId: req.user.organizationId });
  if (!inspection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Inspection not found');
  }

  // Find photo in any room
  let photo = null;
  for (const room of inspection.rooms) {
    photo = room.photos.id(photoId);
    if (photo) break;
  }

  if (!photo) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Photo not found');
  }

  // Get presigned download URL
  const downloadUrl = await storage.getPresignedDownloadUrl(photo.storagePath, {
    expiresIn: 3600, // 1 hour
  });

  res.status(httpStatus.OK).send({
    data: {
      photoId,
      url: downloadUrl,
      expiresIn: 3600,
    },
  });
});

/**
 * Get presigned download URLs for all photos in an inspection
 */
const getAllPhotoUrls = catchAsync(async (req, res) => {
  const { id: inspectionId } = req.params;

  const inspection = await Inspection.findOne({ _id: inspectionId, organizationId: req.user.organizationId });
  if (!inspection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Inspection not found');
  }

  const photoUrls = [];
  
  for (const room of inspection.rooms) {
    for (const photo of room.photos) {
      try {
        const url = await storage.getPresignedDownloadUrl(photo.storagePath, {
          expiresIn: 3600,
        });
        photoUrls.push({
          photoId: photo._id.toString(),
          roomId: room._id.toString(),
          url,
          filename: photo.originalFilename,
        });
      } catch (err) {
        logger.warn({ photoId: photo._id, err: err.message }, 'Failed to get photo URL');
      }
    }
  }

  res.status(httpStatus.OK).send({
    data: photoUrls,
  });
});

module.exports = {
  getUploadUrls,
  registerPhotos,
  uploadPhotos,
  getPhotoUrl,
  getAllPhotoUrls,
};
