/* eslint-disable security/detect-non-literal-fs-filename */
const path = require('path');
const fs = require('fs');
const httpStatus = require('http-status');
const config = require('../config/config');
const ApiError = require('../utils/ApiError');
const ReportPreset = require('../models/reportPreset.model');
const logger = require('../config/logger');
const { generateSchemaFromSampleReport } = require('./ollama.service');

const STORAGE_DIR = path.resolve(config.uploads.dir, 'presets');

const ensureStorageDir = () => {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
};

const saveSampleReport = ({ file }) => {
  if (!file) {
    return null;
  }
  ensureStorageDir();
  const targetPath = path.join(STORAGE_DIR, `${Date.now()}-${file.originalname}`);
  fs.copyFileSync(file.path, targetPath);
  fs.unlink(file.path, (error) => {
    if (error) {
      logger.warn({ err: error }, 'Failed to remove temporary sample report file');
    }
  });
  return targetPath;
};

const createPreset = async ({ organizationId, userId, name, description, schema, sampleReportFile, tags, isDefault }) => {
  const existing = await ReportPreset.findOne({ organizationId, name });
  if (existing) {
    throw new ApiError(httpStatus.CONFLICT, 'Preset name already exists');
  }

  let sampleReportPath = null;
  if (sampleReportFile) {
    sampleReportPath = saveSampleReport({ file: sampleReportFile });
  }

  let effectiveSchema = schema;
  let generatedFromSample = false;

  if (!effectiveSchema) {
    if (!sampleReportPath) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Schema or sample report is required');
    }
    try {
      effectiveSchema = await generateSchemaFromSampleReport({ filePath: sampleReportPath });
      generatedFromSample = true;
    } catch (error) {
      logger.error({ err: error }, 'Failed to generate schema from sample report');
      throw error;
    }
  }

  const shouldBeDefault = Boolean(isDefault);
  if (shouldBeDefault) {
    await ReportPreset.updateMany({ organizationId }, { $set: { isDefault: false } });
  }

  const preset = await ReportPreset.create({
    organizationId,
    createdBy: userId,
    name,
    description,
    schema: effectiveSchema,
    sampleReportPath,
    tags,
    isDefault: shouldBeDefault,
    versions: [
      {
        version: 1,
        schema: effectiveSchema,
        sourceFilePath: sampleReportPath,
      },
    ],
  });

  return {
    ...preset.toObject(),
    schemaGenerated: generatedFromSample,
  };
};

const listPresets = async ({ organizationId }) => {
  const presets = await ReportPreset.find({ organizationId }).sort({ updatedAt: -1 }).lean();
  return presets;
};

const getPresetById = async ({ presetId, organizationId }) => {
  const preset = await ReportPreset.findOne({ _id: presetId, organizationId }).lean();
  if (!preset) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Report preset not found');
  }
  return preset;
};

const getPresetDocument = async ({ presetId, organizationId }) => {
  return ReportPreset.findOne({ _id: presetId, organizationId });
};

const getDefaultPreset = async ({ organizationId }) => {
  const preset = await ReportPreset.findOne({ organizationId, isDefault: true }).sort({ updatedAt: -1 }).lean();
  if (preset) {
    return preset;
  }
  return ReportPreset.findOne({ organizationId }).sort({ updatedAt: -1 }).lean();
};

const updatePreset = async ({ presetId, organizationId, update }) => {
  const preset = await ReportPreset.findOne({ _id: presetId, organizationId });
  if (!preset) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Report preset not found');
  }

  if (typeof update.name !== 'undefined') {
    preset.name = update.name;
  }
  if (typeof update.description !== 'undefined') {
    preset.description = update.description;
  }
  if (Array.isArray(update.tags)) {
    preset.tags = update.tags;
  }
  if (typeof update.schema !== 'undefined') {
    const versions = Array.isArray(preset.versions) ? preset.versions : [];
    const lastVersion = versions.length > 0 ? versions[versions.length - 1].version || 1 : 1;
    const nextVersion = lastVersion + 1;
    preset.schema = update.schema;
    versions.push({
      version: nextVersion,
      schema: update.schema,
      sourceFilePath: preset.sampleReportPath,
    });
    preset.versions = versions;
  }
  if (typeof update.isDefault === 'boolean') {
    if (update.isDefault) {
      await ReportPreset.updateMany({ organizationId, _id: { $ne: presetId } }, { $set: { isDefault: false } });
      preset.isDefault = true;
    } else {
      preset.isDefault = false;
    }
  }

  await preset.save();
  return preset.toObject();
};

const deletePreset = async ({ presetId, organizationId }) => {
  const preset = await ReportPreset.findOneAndDelete({ _id: presetId, organizationId });
  if (!preset) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Report preset not found');
  }

  if (preset.sampleReportPath && fs.existsSync(preset.sampleReportPath)) {
    fs.unlink(preset.sampleReportPath, (error) => {
      if (error) {
        logger.warn({ err: error }, 'Failed to delete sample report file');
      }
    });
  }

  return preset.toObject();
};

module.exports = {
  createPreset,
  listPresets,
  getPresetById,
  getPresetDocument,
  getDefaultPreset,
  updatePreset,
  deletePreset,
};
