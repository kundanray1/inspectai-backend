const mongoose = require('mongoose');
const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');
const { Inspection } = require('../models/inspection.model');
const { generateRoomAnalysis } = require('../services/aiAnalysis.service');
const { createInspection, addRoomToInspection, updateRoomInInspection } = require('../services/inspection.service');

const listInspections = catchAsync(async (req, res) => {
  const { status, propertyId } = req.query;
  const query = {};

  if (req.user && req.user.organizationId) {
    query.organizationId = req.user.organizationId;
  }
  if (status) query.status = status;
  if (propertyId) query.propertyId = propertyId;

  const inspections = await Inspection.find(query).sort({ updatedAt: -1 }).populate('propertyId').lean();

  res.send({ data: inspections });
});

const createInspectionHandler = catchAsync(async (req, res) => {
  if (!req.user) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
  }

  const inspection = await createInspection({
    ...req.body,
    organizationId: req.user.organizationId,
    createdBy: req.user.id,
  });

  logger.info(`Inspection created ${inspection.id}`);
  res.status(httpStatus.CREATED).send({ data: inspection });
});

const getInspection = catchAsync(async (req, res) => {
  const { id } = req.params;
  const orgId = req.user ? req.user.organizationId : undefined;
  const inspection = await Inspection.findOne({ _id: id, organizationId: orgId }).populate('propertyId').lean();

  if (!inspection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Inspection not found');
  }

  res.send({ data: inspection });
});

const updateInspectionHandler = catchAsync(async (req, res) => {
  const { id } = req.params;
  const orgId = req.user ? req.user.organizationId : undefined;
  const updatePayload = { ...req.body };
  if (updatePayload.reportPresetId) {
    updatePayload.reportPresetId = new mongoose.Types.ObjectId(updatePayload.reportPresetId);
  }

  const inspection = await Inspection.findOneAndUpdate({ _id: id, organizationId: orgId }, updatePayload, {
    new: true,
    runValidators: true,
  }).lean();

  if (!inspection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Inspection not found');
  }

  logger.info(`Inspection updated ${id}`);
  res.send({ data: inspection });
});

const addRoom = catchAsync(async (req, res) => {
  const { id } = req.params;
  if (!req.user) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
  }

  const inspection = await addRoomToInspection(id, req.user.organizationId, req.body);

  if (!inspection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Inspection not found');
  }

  res.status(httpStatus.CREATED).send({ data: inspection });
});

const updateRoom = catchAsync(async (req, res) => {
  const { id, roomId } = req.params;
  if (!req.user) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
  }

  const inspection = await updateRoomInInspection(id, roomId, req.user.organizationId, req.body);

  if (!inspection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Room not found');
  }

  res.send({ data: inspection });
});

const analyseRoom = catchAsync(async (req, res) => {
  const { id, roomId } = req.params;
  const { observations = [] } = req.body;

  const orgId = req.user ? req.user.organizationId : undefined;
  const inspection = await Inspection.findOne({ _id: id, organizationId: orgId });
  if (!inspection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Inspection not found');
  }

  const room = inspection.rooms.id(roomId);
  if (!room) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Room not found');
  }

  const analysis = await generateRoomAnalysis({
    roomName: room.name,
    observations,
    existingIssues: room.photos.reduce((acc, photo) => {
      if (photo.issues && photo.issues.length) {
        acc.push(...photo.issues);
      }
      return acc;
    }, []),
  });

  room.aiSummary = analysis.summary;
  room.actions = analysis.actions;
  room.conditionRating = analysis.conditionRating;
  inspection.markModified('rooms');
  await inspection.save();

  res.send({ data: { analysis, room } });
});

const completeInspection = catchAsync(async (req, res) => {
  const { id } = req.params;

  const orgId = req.user ? req.user.organizationId : undefined;
  const inspection = await Inspection.findOneAndUpdate(
    { _id: id, organizationId: orgId },
    { status: 'completed', completedAt: new Date() },
    { new: true }
  ).lean();

  if (!inspection) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Inspection not found');
  }

  res.send({ data: inspection });
});

module.exports = {
  listInspections,
  createInspection: createInspectionHandler,
  getInspection,
  updateInspection: updateInspectionHandler,
  addRoom,
  updateRoom,
  analyseRoom,
  completeInspection,
};
