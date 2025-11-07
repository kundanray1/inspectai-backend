const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { reportPresetService } = require('../services');
const ApiError = require('../utils/ApiError');

const parseJsonField = (value, fieldName) => {
  if (typeof value === 'undefined' || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw new ApiError(httpStatus.BAD_REQUEST, `Invalid JSON supplied for ${fieldName}`);
    }
  }
  return value;
};

const parseTags = (value) => {
  const parsed = parseJsonField(value, 'tags');
  if (typeof parsed === 'undefined') {
    return undefined;
  }
  if (Array.isArray(parsed)) {
    return parsed.map((tag) => String(tag)).filter((tag) => tag.trim().length > 0);
  }
  if (typeof parsed === 'string') {
    return parsed
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  }
  throw new ApiError(httpStatus.BAD_REQUEST, 'Tags must be an array or comma separated string');
};

const parseBoolean = (value) => {
  if (typeof value === 'undefined' || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  }
  return Boolean(value);
};

const createPreset = catchAsync(async (req, res) => {
  const schema = parseJsonField(req.body.schema, 'schema');
  const parsedTags = parseTags(req.body.tags);
  const tags = Array.isArray(parsedTags) ? parsedTags : [];
  const isDefault = parseBoolean(req.body.isDefault);

  const preset = await reportPresetService.createPreset({
    organizationId: req.user.organizationId,
    userId: req.user.id,
    name: req.body.name,
    description: req.body.description,
    schema,
    tags,
    sampleReportFile: req.file,
    isDefault,
  });

  res.status(httpStatus.CREATED).send({ data: preset });
});

const listPresets = catchAsync(async (req, res) => {
  const presets = await reportPresetService.listPresets({ organizationId: req.user.organizationId });
  res.send({ data: presets });
});

const getPreset = catchAsync(async (req, res) => {
  const preset = await reportPresetService.getPresetById({
    presetId: req.params.presetId,
    organizationId: req.user.organizationId,
  });
  res.send({ data: preset });
});

const updatePreset = catchAsync(async (req, res) => {
  const updatePayload = {};
  if (typeof req.body.name !== 'undefined') updatePayload.name = req.body.name;
  if (typeof req.body.description !== 'undefined') updatePayload.description = req.body.description;

  const schema = parseJsonField(req.body.schema, 'schema');
  if (typeof schema !== 'undefined') {
    updatePayload.schema = schema;
  }

  const tags = parseTags(req.body.tags);
  if (typeof tags !== 'undefined') {
    updatePayload.tags = tags;
  }

  const isDefault = parseBoolean(req.body.isDefault);
  if (typeof isDefault !== 'undefined') {
    updatePayload.isDefault = isDefault;
  }

  const preset = await reportPresetService.updatePreset({
    presetId: req.params.presetId,
    organizationId: req.user.organizationId,
    update: updatePayload,
  });

  res.send({ data: preset });
});

const deletePreset = catchAsync(async (req, res) => {
  await reportPresetService.deletePreset({
    presetId: req.params.presetId,
    organizationId: req.user.organizationId,
  });

  res.status(httpStatus.NO_CONTENT).send();
});

module.exports = {
  createPreset,
  listPresets,
  getPreset,
  updatePreset,
  deletePreset,
};
