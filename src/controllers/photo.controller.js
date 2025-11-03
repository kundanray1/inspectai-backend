const path = require('path');
const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/ApiError');
const config = require('../config/config');
const { Inspection } = require('../models/inspection.model');
const logger = require('../config/logger');

const uploadPhotos = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { roomId } = req.body;
  const files = Array.isArray(req.files) ? req.files : [];

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

  files.forEach((file) => {
    const photo = room.photos.create({
      storagePath: path.join(config.uploads.dir, file.filename),
      originalFilename: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
    });
    room.photos.push(photo);
  });

  inspection.markModified('rooms');
  await inspection.save();

  logger.info(`Uploaded ${files.length} photos to inspection ${id}`);
  res.status(httpStatus.CREATED).send({ data: room.photos });
});

module.exports = {
  uploadPhotos,
};
