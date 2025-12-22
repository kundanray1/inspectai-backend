/* eslint-disable no-console */
const { Worker } = require('bullmq');
const mongoose = require('mongoose');
const logger = require('../src/config/logger');
const config = require('../src/config/config');
const { jobService, reportPresetService } = require('../src/services');
const { Inspection } = require('../src/models/inspection.model');
const geminiService = require('../src/services/ai/gemini.service');
const fs = require('fs');
const path = require('path');

// Standard room classifications
const ROOM_CLASSIFICATIONS = [
  'Kitchen',
  'Living Room',
  'Dining Room',
  'Bedroom',
  'Master Bedroom',
  'Bathroom',
  'Master Bathroom',
  'Garage',
  'Basement',
  'Attic',
  'Laundry Room',
  'Office',
  'Hallway',
  'Entrance',
  'Patio',
  'Deck',
  'Backyard',
  'Front Yard',
  'Exterior',
  'Roof',
  'HVAC',
  'Electrical Panel',
  'Water Heater',
  'Other',
];

/**
 * Use Gemini Vision to classify a room from an image
 */
async function classifyRoomFromImage(imagePath) {
  try {
    if (!fs.existsSync(imagePath)) {
      logger.warn({ imagePath }, 'Image file not found for classification');
      return { roomType: 'Other', confidence: 0.5 };
    }

    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const ext = path.extname(imagePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

    const prompt = `Analyze this property inspection photo and classify what room or area it shows.
    
Choose ONE of these categories:
${ROOM_CLASSIFICATIONS.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Respond with ONLY a JSON object in this exact format:
{
  "roomType": "the room type from the list above",
  "confidence": 0.0 to 1.0,
  "features": ["list", "of", "key", "features", "visible"]
}`;

    const result = await geminiService.generateWithVision({
      prompt,
      images: [{ mimeType, data: base64Image }],
    });

    // Parse the JSON response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      // Validate room type is in our list
      if (ROOM_CLASSIFICATIONS.includes(parsed.roomType)) {
        return parsed;
      }
    }

    return { roomType: 'Other', confidence: 0.5, features: [] };
  } catch (error) {
    logger.error({ err: error, imagePath }, 'Failed to classify room from image');
    return { roomType: 'Other', confidence: 0.3, features: [] };
  }
}

/**
 * Use Gemini Vision to analyze an image for issues
 */
async function analyzeImageForIssues(imagePath, roomType) {
  try {
    if (!fs.existsSync(imagePath)) {
      logger.warn({ imagePath }, 'Image file not found for analysis');
      return { issues: [], condition: 'unrated', summary: '' };
    }

    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');
    const ext = path.extname(imagePath).toLowerCase();
    const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

    const prompt = `You are a professional property inspector analyzing a ${roomType} photo.

Identify any issues, damage, wear, or maintenance needs visible in this image.

Respond with ONLY a JSON object in this exact format:
{
  "issues": [
    {
      "label": "Brief issue description",
      "severity": "low" | "medium" | "high",
      "category": "structural" | "electrical" | "plumbing" | "cosmetic" | "safety" | "appliance" | "other",
      "recommendation": "What should be done"
    }
  ],
  "condition": "excellent" | "good" | "fair" | "poor" | "critical",
  "summary": "A 1-2 sentence summary of the overall condition",
  "positives": ["list", "of", "positive", "aspects"]
}`;

    const result = await geminiService.generateWithVision({
      prompt,
      images: [{ mimeType, data: base64Image }],
    });

    // Parse the JSON response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    return { issues: [], condition: 'unrated', summary: 'Unable to analyze image' };
  } catch (error) {
    logger.error({ err: error, imagePath }, 'Failed to analyze image for issues');
    return { issues: [], condition: 'unrated', summary: 'Analysis failed' };
  }
}

/**
 * Process an inspection job with AI classification
 */
async function processInspectionJob(job) {
  const { jobId, inspectionId, organizationId, payload } = job.data;
  const { photoIds, aiClassificationMode } = payload;

  try {
    logger.info({ jobId, aiClassificationMode }, 'Processing inspection job');

    await jobService.updateJobProgress({
      jobId,
      status: 'processing',
      progress: 5,
      message: aiClassificationMode ? 'Starting AI room classification...' : 'Starting photo analysis...',
    });

    const inspection = await Inspection.findOne({ _id: inspectionId, organizationId });
    if (!inspection) {
      throw new Error('Inspection not found');
    }

    // Get all photos to process
    const photosToProcess = [];
    for (const room of inspection.rooms) {
      for (const photo of room.photos) {
        if (photoIds.includes(photo._id.toString())) {
          photosToProcess.push({ photo, originalRoom: room });
        }
      }
    }

    const totalPhotos = photosToProcess.length;
    const roomClassifications = new Map(); // roomType -> [photos]

    // Process each photo
    for (let i = 0; i < photosToProcess.length; i++) {
      const { photo, originalRoom } = photosToProcess[i];
      const progress = Math.round(((i + 1) / totalPhotos) * 80) + 10;

      await jobService.updateJobProgress({
        jobId,
        processedUnits: i + 1,
        totalUnits: totalPhotos,
        progress,
        message: `Processing photo ${i + 1}/${totalPhotos}: ${photo.originalFilename}`,
      });

      let roomType = originalRoom.name;
      let classification = null;

      // If in AI classification mode, classify the room
      if (aiClassificationMode && originalRoom.name === '_pending_classification') {
        classification = await classifyRoomFromImage(photo.storagePath);
        roomType = classification.roomType;
        logger.info({ photoId: photo._id, roomType, confidence: classification.confidence }, 'Classified photo');
      }

      // Analyze for issues
      const analysis = await analyzeImageForIssues(photo.storagePath, roomType);

      // Update photo with analysis results
      photo.roomClassification = roomType;
      photo.classificationConfidence = classification?.confidence;
      photo.issues = analysis.issues || [];
      photo.aiSummary = analysis.summary;
      photo.condition = analysis.condition;
      photo.positives = analysis.positives || [];
      photo.pendingClassification = false;

      // Group by room type for reorganization
      if (!roomClassifications.has(roomType)) {
        roomClassifications.set(roomType, []);
      }
      roomClassifications.get(roomType).push({ photo, analysis, originalRoom });
    }

    // Reorganize photos into proper rooms if in AI classification mode
    if (aiClassificationMode) {
      await jobService.updateJobProgress({
        jobId,
        progress: 90,
        message: 'Organizing photos into rooms...',
      });

      // Remove photos from pending room
      const pendingRoom = inspection.rooms.find((r) => r.name === '_pending_classification');
      if (pendingRoom) {
        pendingRoom.photos = pendingRoom.photos.filter(
          (p) => !photoIds.includes(p._id.toString())
        );
      }

      // Create or update rooms for each classification
      for (const [roomType, photoData] of roomClassifications) {
        let room = inspection.rooms.find(
          (r) => r.name === roomType && r.name !== '_pending_classification'
        );

        if (!room) {
          // Create new room
          inspection.rooms.push({
            name: roomType,
            displayOrder: inspection.rooms.filter((r) => r.name !== '_pending_classification').length + 1,
            conditionRating: 'unrated',
            photos: [],
          });
          room = inspection.rooms[inspection.rooms.length - 1];
        }

        // Move photos to this room
        for (const { photo, analysis } of photoData) {
          // Add photo to room
          room.photos.push({
            ...photo.toObject(),
            _id: photo._id,
          });
        }

        // Update room condition based on photos
        const conditions = photoData.map((p) => p.analysis.condition).filter(Boolean);
        if (conditions.length > 0) {
          const conditionScores = { excellent: 5, good: 4, fair: 3, poor: 2, critical: 1, unrated: 0 };
          const avgScore = conditions.reduce((sum, c) => sum + (conditionScores[c] || 0), 0) / conditions.length;
          const conditionNames = ['unrated', 'critical', 'poor', 'fair', 'good', 'excellent'];
          room.conditionRating = conditionNames[Math.round(avgScore)] || 'unrated';
        }

        // Generate room summary from photo analyses
        const allIssues = photoData.flatMap((p) => p.analysis.issues || []);
        const allPositives = photoData.flatMap((p) => p.analysis.positives || []);
        room.aiSummary = `${roomType} inspection: ${photoData.length} photo(s) analyzed. ${allIssues.length} issue(s) found.`;
        room.actions = allIssues.filter((i) => i.severity === 'high').map((i) => i.recommendation).filter(Boolean);
      }

      // Remove empty pending room
      inspection.rooms = inspection.rooms.filter(
        (r) => r.name !== '_pending_classification' || r.photos.length > 0
      );
    }

    inspection.markModified('rooms');
    await inspection.save();

    const result = {
      summary: `Processed ${totalPhotos} photos across ${roomClassifications.size} rooms.`,
      metrics: {
        processedPhotos: totalPhotos,
        roomsIdentified: roomClassifications.size,
        totalIssues: [...roomClassifications.values()].flatMap((pd) => pd.flatMap((p) => p.analysis.issues || [])).length,
      },
    };

    await jobService.markJobCompleted({ jobId, result, message: 'Analysis completed' });
    logger.info({ jobId, result }, 'Inspection job completed');

    return result;
  } catch (error) {
    logger.error({ err: error, jobId }, 'Inspection job failed');
    await jobService.markJobFailed({ jobId, error });
    throw error;
  }
}

// Connect to MongoDB
mongoose
  .connect(config.mongoose.url, config.mongoose.options)
  .then(() => {
    logger.info('Connected to MongoDB for worker');
  })
  .catch((err) => {
    logger.error({ err }, 'MongoDB connection error in worker');
    process.exit(1);
  });

// Create BullMQ worker
const redisUrl = config.redis?.url || process.env.REDIS_URL || 'redis://localhost:6379';
const redisConfig = new URL(redisUrl);

const worker = new Worker(
  'inspection-analysis',
  processInspectionJob,
  {
    connection: {
      host: redisConfig.hostname,
      port: parseInt(redisConfig.port, 10) || 6379,
      password: redisConfig.password || undefined,
    },
    concurrency: 2,
  }
);

worker.on('completed', (job, result) => {
  logger.info({ jobId: job.data.jobId, result }, 'Worker completed job');
});

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.data?.jobId, err }, 'Worker job failed');
});

worker.on('error', (err) => {
  logger.error({ err }, 'Worker error');
});

logger.info('BullMQ inspection worker started');

process.on('SIGINT', async () => {
  logger.info('Worker received SIGINT, closing...');
  await worker.close();
  await mongoose.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Worker received SIGTERM, closing...');
  await worker.close();
  await mongoose.disconnect();
  process.exit(0);
});
