/* eslint-disable security/detect-non-literal-fs-filename */
const path = require('path');
const fs = require('fs');
const httpStatus = require('http-status');
const config = require('../config/config');
const ApiError = require('../utils/ApiError');
const ReportPreset = require('../models/reportPreset.model');
const logger = require('../config/logger');
const { extractSchemaFromPdf, getDefaultSections } = require('./ai/schemaExtraction.service');

const STORAGE_DIR = path.resolve(config.uploads.dir, 'presets');

const ensureStorageDir = () => {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
};

const buildFallbackSchema = (name = 'Inspection') => {
  const safeName = name && typeof name === 'string' ? name.trim() : 'Inspection';
  return {
    title: `${safeName} flexible schema`,
    sections: [
      {
        name: 'Custom section',
        description: 'Add any fields, nested objects, or arrays that match your reporting requirements.',
        fields: [],
      },
    ],
    metadata: {
      derivedFrom: 'fallback-template',
      version: 1,
      notes:
        'Fallback generated because automatic schema extraction failed. Edit this schema to add the exact variables you need.',
    },
  };
};

const generateSchemaWithFallback = async ({ sampleReportPath, presetName }) => {
  try {
    // Use Gemini Vision to extract schema from PDF
    const result = await extractSchemaFromPdf({ filePath: sampleReportPath });
    logger.info(
      { 
        confidence: result.confidence, 
        warnings: result.warnings,
        suggestions: result.suggestions 
      },
      'Schema extracted from PDF using Gemini Vision'
    );
    return {
      schema: result.schema,
      generatedFromSample: true,
      usedFallback: false,
      confidence: result.confidence,
      warnings: result.warnings,
      suggestions: result.suggestions,
    };
  } catch (error) {
    logger.warn({ err: error }, 'Falling back to default schema template for report preset');
    return {
      schema: buildFallbackSchema(presetName),
      generatedFromSample: false,
      usedFallback: true,
      confidence: 0,
      warnings: [`Schema extraction failed: ${error.message}`],
      suggestions: ['Consider uploading a clearer PDF or manually editing the schema'],
    };
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
  let fallbackApplied = false;

  if (!effectiveSchema) {
    if (!sampleReportPath) {
      throw new ApiError(httpStatus.BAD_REQUEST, 'Schema or sample report is required');
    }
    const schemaResult = await generateSchemaWithFallback({ sampleReportPath, presetName: name });
    effectiveSchema = schemaResult.schema;
    generatedFromSample = schemaResult.generatedFromSample;
    fallbackApplied = schemaResult.usedFallback;
    logger.info(
      {
        schema: effectiveSchema,
        generatedFromSample,
        fallbackApplied,
        presetName: name,
      },
      'Resolved schema for report preset creation'
    );
  }

  const shouldBeDefault = Boolean(isDefault);
  if (shouldBeDefault) {
    await ReportPreset.updateMany({ organizationId }, { $set: { isDefault: false } });
  }

  const sanitizedSchema = JSON.parse(JSON.stringify(effectiveSchema));
  const normalizedTags = Array.isArray(tags) ? tags.map((tag) => String(tag).trim()).filter(Boolean) : [];

  const versionsPayload = [
    {
      version: 1,
      schema: sanitizedSchema,
      sourceFilePath: sampleReportPath || undefined,
    },
  ];

  const preset = new ReportPreset({
    organizationId,
    createdBy: userId,
    name,
    description,
    schema: sanitizedSchema,
    sampleReportPath,
    tags: normalizedTags,
    isDefault: shouldBeDefault,
    versions: versionsPayload,
  });

  try {
    await preset.validate();
  } catch (error) {
    logger.error({ err: error, presetPayload: preset.toObject({ depopulate: true }) }, 'Report preset validation failed');
    throw error;
  }

  await preset.save();

  return {
    ...preset.toObject(),
    schemaGenerated: generatedFromSample,
    schemaFallbackApplied: fallbackApplied,
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
