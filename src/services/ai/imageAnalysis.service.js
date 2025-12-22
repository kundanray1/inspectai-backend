/**
 * Image Analysis Service
 * 
 * Uses Gemini Vision to analyze inspection photos.
 * Detects room types, issues, and generates condition assessments.
 * 
 * @module services/ai/imageAnalysis
 */

/* eslint-disable security/detect-non-literal-fs-filename */
const fs = require('fs').promises;
const path = require('path');
const httpStatus = require('http-status');
const geminiService = require('./gemini.service');
const logger = require('../../config/logger');
const ApiError = require('../../utils/ApiError');

/**
 * Room classification prompt
 */
const ROOM_CLASSIFICATION_PROMPT = `Analyze this photo and identify what room or space it shows.

Return ONLY valid JSON:
{
  "roomType": "kitchen|bathroom|bedroom|living_room|dining_room|garage|basement|attic|hallway|laundry|office|exterior|roof|yard|other",
  "confidence": 0.95,
  "features": ["list", "of", "notable", "features"],
  "description": "Brief description of the space"
}`;

/**
 * Issue detection prompt
 */
const ISSUE_DETECTION_PROMPT = `Analyze this property inspection photo and identify any issues, damage, or areas of concern.

For each issue found, classify the severity:
- "low": Minor cosmetic issues (scuffs, minor wear)
- "medium": Issues needing attention (small cracks, staining, minor water damage)
- "high": Significant issues requiring immediate attention (structural damage, mold, major water damage, safety hazards)

Return ONLY valid JSON:
{
  "issues": [
    {
      "label": "Brief issue name",
      "description": "Detailed description of the issue",
      "severity": "low|medium|high",
      "confidence": 0.85,
      "location": "Where in the image (e.g., 'upper left corner', 'near window')",
      "recommendation": "Suggested action to address the issue"
    }
  ],
  "overallCondition": "excellent|good|fair|needs_maintenance",
  "qualityWarnings": ["Any issues with the photo itself (blurry, dark, etc.)"],
  "summary": "Brief overall assessment of what's shown in the photo"
}`;

/**
 * Comprehensive analysis prompt
 */
const COMPREHENSIVE_ANALYSIS_PROMPT = `Perform a comprehensive property inspection analysis of this photo.

Analyze:
1. Room/Space Type
2. Condition Assessment
3. Issues and Defects
4. Notable Features
5. Photo Quality

Return ONLY valid JSON:
{
  "roomClassification": {
    "type": "kitchen|bathroom|bedroom|living_room|dining_room|garage|basement|attic|hallway|laundry|office|exterior|roof|yard|other",
    "confidence": 0.95,
    "features": ["notable", "room", "features"]
  },
  "conditionRating": "excellent|good|fair|needs_maintenance",
  "issues": [
    {
      "label": "Issue name",
      "description": "Detailed description",
      "severity": "low|medium|high",
      "confidence": 0.85,
      "recommendation": "Suggested action"
    }
  ],
  "qualityWarnings": ["Photo quality issues if any"],
  "summary": "Professional inspection summary of this photo (2-3 sentences)",
  "aiSummary": "One paragraph detailed narrative description suitable for an inspection report"
}`;

/**
 * Load image as base64
 * @param {string|Buffer} imageInput - Image path or buffer
 * @returns {Promise<{mimeType: string, data: string}>}
 */
const loadImage = async (imageInput) => {
  let buffer;
  let mimeType = 'image/jpeg';

  if (typeof imageInput === 'string') {
    buffer = await fs.readFile(imageInput);
    const ext = path.extname(imageInput).toLowerCase();
    if (ext === '.png') mimeType = 'image/png';
    else if (ext === '.gif') mimeType = 'image/gif';
    else if (ext === '.webp') mimeType = 'image/webp';
  } else {
    buffer = imageInput;
  }

  return {
    mimeType,
    data: buffer.toString('base64'),
  };
};

/**
 * Classify what room/space a photo shows
 * @param {Object} params - Parameters
 * @param {string} [params.imagePath] - Path to image file
 * @param {Buffer} [params.imageBuffer] - Image buffer
 * @param {string} [params.mimeType] - MIME type if using buffer
 * @returns {Promise<Object>}
 */
const classifyRoom = async ({ imagePath, imageBuffer, mimeType = 'image/jpeg' }) => {
  let image;
  if (imagePath) {
    image = await loadImage(imagePath);
  } else if (imageBuffer) {
    image = { mimeType, data: imageBuffer.toString('base64') };
  } else {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Either imagePath or imageBuffer is required');
  }

  logger.debug({ hasPath: !!imagePath }, 'Classifying room from image');

  const result = await geminiService.generateJSON({
    prompt: ROOM_CLASSIFICATION_PROMPT,
    images: [image],
  });

  // Validate and normalize
  const validRoomTypes = [
    'kitchen', 'bathroom', 'bedroom', 'living_room', 'dining_room',
    'garage', 'basement', 'attic', 'hallway', 'laundry', 'office',
    'exterior', 'roof', 'yard', 'other',
  ];

  if (!validRoomTypes.includes(result.roomType)) {
    result.roomType = 'other';
  }

  return {
    roomType: result.roomType,
    confidence: result.confidence || 0.7,
    features: result.features || [],
    description: result.description || '',
  };
};

/**
 * Detect issues in an inspection photo
 * @param {Object} params - Parameters
 * @param {string} [params.imagePath] - Path to image file
 * @param {Buffer} [params.imageBuffer] - Image buffer
 * @param {string} [params.mimeType] - MIME type if using buffer
 * @param {string} [params.roomContext] - Optional room context
 * @returns {Promise<Object>}
 */
const detectIssues = async ({ imagePath, imageBuffer, mimeType = 'image/jpeg', roomContext }) => {
  let image;
  if (imagePath) {
    image = await loadImage(imagePath);
  } else if (imageBuffer) {
    image = { mimeType, data: imageBuffer.toString('base64') };
  } else {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Either imagePath or imageBuffer is required');
  }

  let prompt = ISSUE_DETECTION_PROMPT;
  if (roomContext) {
    prompt = `This photo is from a ${roomContext}.\n\n${prompt}`;
  }

  logger.debug({ hasPath: !!imagePath, roomContext }, 'Detecting issues in image');

  const result = await geminiService.generateJSON({
    prompt,
    images: [image],
  });

  // Validate and normalize issues
  const issues = (result.issues || []).map((issue) => ({
    label: issue.label || 'Unknown issue',
    description: issue.description || '',
    severity: ['low', 'medium', 'high'].includes(issue.severity) ? issue.severity : 'low',
    confidence: issue.confidence || 0.7,
    location: issue.location || '',
    recommendation: issue.recommendation || '',
  }));

  // Validate condition rating
  const validConditions = ['excellent', 'good', 'fair', 'needs_maintenance'];
  const overallCondition = validConditions.includes(result.overallCondition)
    ? result.overallCondition
    : 'good';

  return {
    issues,
    overallCondition,
    qualityWarnings: result.qualityWarnings || [],
    summary: result.summary || '',
  };
};

/**
 * Perform comprehensive analysis of an inspection photo
 * @param {Object} params - Parameters
 * @param {string} [params.imagePath] - Path to image file
 * @param {Buffer} [params.imageBuffer] - Image buffer
 * @param {string} [params.mimeType] - MIME type if using buffer
 * @returns {Promise<Object>}
 */
const analyzePhoto = async ({ imagePath, imageBuffer, mimeType = 'image/jpeg' }) => {
  let image;
  if (imagePath) {
    image = await loadImage(imagePath);
  } else if (imageBuffer) {
    image = { mimeType, data: imageBuffer.toString('base64') };
  } else {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Either imagePath or imageBuffer is required');
  }

  logger.debug({ hasPath: !!imagePath }, 'Performing comprehensive photo analysis');

  const result = await geminiService.generateJSON({
    prompt: COMPREHENSIVE_ANALYSIS_PROMPT,
    images: [image],
  });

  // Validate room classification
  const validRoomTypes = [
    'kitchen', 'bathroom', 'bedroom', 'living_room', 'dining_room',
    'garage', 'basement', 'attic', 'hallway', 'laundry', 'office',
    'exterior', 'roof', 'yard', 'other',
  ];

  const roomType = validRoomTypes.includes(result.roomClassification?.type)
    ? result.roomClassification.type
    : 'other';

  // Validate condition
  const validConditions = ['excellent', 'good', 'fair', 'needs_maintenance'];
  const conditionRating = validConditions.includes(result.conditionRating)
    ? result.conditionRating
    : 'good';

  // Normalize issues
  const issues = (result.issues || []).map((issue) => ({
    label: issue.label || 'Unknown issue',
    description: issue.description || '',
    severity: ['low', 'medium', 'high'].includes(issue.severity) ? issue.severity : 'low',
    confidence: issue.confidence || 0.7,
    recommendation: issue.recommendation || '',
  }));

  return {
    roomClassification: roomType,
    classificationConfidence: result.roomClassification?.confidence || 0.7,
    roomFeatures: result.roomClassification?.features || [],
    conditionRating,
    issues,
    qualityWarnings: result.qualityWarnings || [],
    summary: result.summary || '',
    aiSummary: result.aiSummary || result.summary || '',
  };
};

/**
 * Analyze multiple photos for a room
 * @param {Object} params - Parameters
 * @param {Array<{path?: string, buffer?: Buffer, mimeType?: string}>} params.photos - Photos to analyze
 * @param {string} [params.roomName] - Optional room name for context
 * @returns {Promise<Object>}
 */
const analyzeRoomPhotos = async ({ photos, roomName }) => {
  if (!photos || photos.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'At least one photo is required');
  }

  logger.info({ photoCount: photos.length, roomName }, 'Analyzing room photos');

  // Analyze each photo
  const analysisResults = await Promise.all(
    photos.map(async (photo) => {
      try {
        return await analyzePhoto({
          imagePath: photo.path,
          imageBuffer: photo.buffer,
          mimeType: photo.mimeType,
        });
      } catch (error) {
        logger.warn({ error: error.message }, 'Failed to analyze photo');
        return null;
      }
    })
  );

  const validResults = analysisResults.filter(Boolean);

  if (validResults.length === 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Failed to analyze any photos');
  }

  // Aggregate results
  const allIssues = [];
  const conditionCounts = { excellent: 0, good: 0, fair: 0, needs_maintenance: 0 };
  const roomTypeCounts = {};
  const allWarnings = [];
  const summaries = [];

  validResults.forEach((result) => {
    allIssues.push(...result.issues);
    conditionCounts[result.conditionRating]++;
    roomTypeCounts[result.roomClassification] = (roomTypeCounts[result.roomClassification] || 0) + 1;
    allWarnings.push(...result.qualityWarnings);
    if (result.aiSummary) summaries.push(result.aiSummary);
  });

  // Determine overall condition (worst case)
  let overallCondition = 'excellent';
  if (conditionCounts.needs_maintenance > 0) overallCondition = 'needs_maintenance';
  else if (conditionCounts.fair > 0) overallCondition = 'fair';
  else if (conditionCounts.good > 0) overallCondition = 'good';

  // Determine most likely room type
  const mostLikelyRoom = Object.entries(roomTypeCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'other';

  // Deduplicate issues by label
  const uniqueIssues = [];
  const seenLabels = new Set();
  allIssues.forEach((issue) => {
    const key = issue.label.toLowerCase();
    if (!seenLabels.has(key)) {
      seenLabels.add(key);
      uniqueIssues.push(issue);
    }
  });

  // Sort issues by severity
  const severityOrder = { high: 0, medium: 1, low: 2 };
  uniqueIssues.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // Generate combined summary
  const combinedSummary = summaries.length > 0
    ? summaries.join(' ')
    : `Analysis of ${validResults.length} photos from the ${roomName || mostLikelyRoom}.`;

  return {
    roomClassification: mostLikelyRoom,
    conditionRating: overallCondition,
    issues: uniqueIssues,
    qualityWarnings: [...new Set(allWarnings)],
    photosAnalyzed: validResults.length,
    aiSummary: combinedSummary,
    individualResults: validResults,
  };
};

module.exports = {
  classifyRoom,
  detectIssues,
  analyzePhoto,
  analyzeRoomPhotos,
  loadImage,
};

