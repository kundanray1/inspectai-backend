const httpStatus = require('http-status');
const mongoose = require('mongoose');
const catchAsync = require('../utils/catchAsync');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');
const { Property } = require('../models');

const listProperties = catchAsync(async (req, res) => {
  const organizationId = req.user ? req.user.organizationId : undefined;
  const query = organizationId ? { organizationId } : {};
  const properties = await Property.find(query).sort({ updatedAt: -1 }).lean();

  res.send({ data: properties });
});

const createProperty = catchAsync(async (req, res) => {
  const { name, referenceCode, address, metadata } = req.body;
  const organizationId = req.user ? req.user.organizationId : undefined;
  const userId = req.user ? req.user.id : undefined;

  if (!organizationId || !userId) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
  }

  const property = await Property.create({
    name,
    organizationId,
    referenceCode,
    address,
    metadata,
    createdBy: new mongoose.Types.ObjectId(userId),
  });

  logger.info(`Property created ${property.id}`);
  res.status(httpStatus.CREATED).send({ data: property });
});

const getProperty = catchAsync(async (req, res) => {
  const { id } = req.params;
  const property = await Property.findById(id).lean();

  if (!property) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Property not found');
  }

  if (req.user && req.user.organizationId && property.organizationId !== req.user.organizationId) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
  }

  res.send({ data: property });
});

const updateProperty = catchAsync(async (req, res) => {
  const { id } = req.params;
  const property = await Property.findByIdAndUpdate(id, req.body, {
    new: true,
    runValidators: true,
  }).lean();

  if (!property) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Property not found');
  }

  if (req.user && req.user.organizationId && property.organizationId !== req.user.organizationId) {
    throw new ApiError(httpStatus.FORBIDDEN, 'Forbidden');
  }

  logger.info(`Property updated ${id}`);
  res.send({ data: property });
});

module.exports = {
  listProperties,
  createProperty,
  getProperty,
  updateProperty,
};
