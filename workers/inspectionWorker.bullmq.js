/* eslint-disable no-console */
const { Worker } = require('bullmq');
const mongoose = require('mongoose');
const Redis = require('ioredis');
const logger = require('../src/config/logger');
const config = require('../src/config/config');
const { QUEUE_NAMES, getRedisConnection } = require('../src/queues/queue.config');
const { jobService, reportPresetService } = require('../src/services');
const { Inspection } = require('../src/models/inspection.model');
const geminiService = require('../src/services/ai/gemini.service');
const R2Storage = require('../src/lib/storage/r2.storage');

// Initialize R2 storage
const storage = new R2Storage();

// Redis for pub/sub socket events - use same connection as queue
const redisUrl = config.redis?.url || process.env.REDIS_URL || 'redis://localhost:6379';
const pubClient = new Redis(redisUrl);

// Emit socket events via Redis pub/sub
const emitSocketEvent = (inspectionId, event, payload) => {
  pubClient.publish('socket:events', JSON.stringify({
    channel: `inspection:${inspectionId}`,
    event,
    payload,
  }));
};

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
 * Download image from R2 and return base64
 */
async function getImageFromR2(storagePath) {
  try {
    logger.info({ storagePath }, 'Downloading image from R2');
    const buffer = await storage.download(storagePath);
    const base64 = buffer.toString('base64');
    
    // Detect mime type from path
    const ext = storagePath.split('.').pop()?.toLowerCase();
    const mimeType = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    
    return { base64, mimeType };
  } catch (error) {
    logger.error({ err: error, storagePath }, 'Failed to download image from R2');
    return null;
  }
}

/**
 * Use Gemini Vision to classify a room from an image
 */
async function classifyRoomFromImage(storagePath) {
  try {
    const imageData = await getImageFromR2(storagePath);
    if (!imageData) {
      logger.warn({ storagePath }, 'Could not download image for classification');
      return { roomType: 'Other', confidence: 0.5, features: [] };
    }

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
      images: [{ mimeType: imageData.mimeType, data: imageData.base64 }],
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
    logger.error({ err: error, storagePath }, 'Failed to classify room from image');
    return { roomType: 'Other', confidence: 0.3, features: [] };
  }
}

/**
 * Use Gemini Vision to analyze an image for issues
 */
async function analyzeImageForIssues(storagePath, roomType) {
  try {
    const imageData = await getImageFromR2(storagePath);
    if (!imageData) {
      logger.warn({ storagePath }, 'Could not download image for analysis');
      return { issues: [], condition: 'unrated', summary: 'Image not available' };
    }

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
      images: [{ mimeType: imageData.mimeType, data: imageData.base64 }],
    });

    // Parse the JSON response
    const jsonMatch = result.text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    return { issues: [], condition: 'unrated', summary: 'Unable to analyze image' };
  } catch (error) {
    logger.error({ err: error, storagePath }, 'Failed to analyze image for issues');
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
    logger.info({ jobId, inspectionId, photoCount: photoIds?.length, aiClassificationMode }, 'Processing inspection job');

    // Update job status
    await jobService.updateJobProgress({
      jobId,
      status: 'processing',
      progress: 5,
      message: aiClassificationMode ? 'Starting AI room classification...' : 'Starting photo analysis...',
    });

    // Emit socket event
    emitSocketEvent(inspectionId, 'job.processing', { jobId, progress: 5, message: 'Starting analysis...' });

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

    if (photosToProcess.length === 0) {
      logger.warn({ jobId, photoIds }, 'No photos found to process');
      await jobService.markJobCompleted({ jobId, result: { message: 'No photos to process' } });
      return { message: 'No photos to process' };
    }

    const totalPhotos = photosToProcess.length;
    const roomClassifications = new Map(); // roomType -> [photos]

    // Process each photo
    for (let i = 0; i < photosToProcess.length; i++) {
      const { photo, originalRoom } = photosToProcess[i];
      const progress = Math.round(((i + 1) / totalPhotos) * 80) + 10;

      const progressMessage = `Processing photo ${i + 1}/${totalPhotos}: ${photo.originalFilename}`;
      
      await jobService.updateJobProgress({
        jobId,
        processedUnits: i + 1,
        totalUnits: totalPhotos,
        progress,
        message: progressMessage,
      });

      // Emit real-time socket event
      emitSocketEvent(inspectionId, 'job.progress', {
        jobId,
        progress,
        processedUnits: i + 1,
        totalUnits: totalPhotos,
        message: progressMessage,
        currentPhoto: photo.originalFilename,
      });

      let roomType = originalRoom.name;
      let classification = null;

      // If in AI classification mode, classify the room
      if (aiClassificationMode && originalRoom.name === '_pending_classification') {
        classification = await classifyRoomFromImage(photo.storagePath);
        roomType = classification.roomType;
        logger.info({ photoId: photo._id, roomType, confidence: classification.confidence }, 'Classified photo');
        
        emitSocketEvent(inspectionId, 'photo.classified', {
          photoId: photo._id.toString(),
          roomType,
          confidence: classification.confidence,
        });
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

      // Emit photo analyzed event
      emitSocketEvent(inspectionId, 'photo.analyzed', {
        photoId: photo._id.toString(),
        roomType,
        issues: analysis.issues?.length || 0,
        condition: analysis.condition,
        summary: analysis.summary,
      });

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

      emitSocketEvent(inspectionId, 'job.progress', {
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
          
          emitSocketEvent(inspectionId, 'room.created', {
            roomId: room._id?.toString(),
            name: roomType,
            photoCount: photoData.length,
          });
        }

        // Move photos to this room
        for (const { photo } of photoData) {
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
    
    // Emit completion event
    emitSocketEvent(inspectionId, 'job.completed', {
      jobId,
      result,
      message: 'Analysis completed successfully',
    });

    // Emit inspection updated event for UI refresh
    emitSocketEvent(inspectionId, 'inspection.updated', {
      inspectionId,
      rooms: inspection.rooms.map(r => ({
        id: r._id?.toString(),
        name: r.name,
        photoCount: r.photos.length,
        condition: r.conditionRating,
      })),
    });

    logger.info({ jobId, result }, 'Inspection job completed');

    return result;
  } catch (error) {
    logger.error({ err: error, jobId }, 'Inspection job failed');
    await jobService.markJobFailed({ jobId, error });
    
    emitSocketEvent(inspectionId, 'job.failed', {
      jobId,
      error: error.message,
    });
    
    throw error;
  }
}

// Startup
logger.info('=== INSPECTION WORKER STARTING ===');
logger.info({ 
  nodeVersion: process.version,
  pid: process.pid,
  env: process.env.NODE_ENV,
});

// Connect to MongoDB
mongoose
  .connect(config.mongoose.url, config.mongoose.options)
  .then(() => {
    logger.info('Worker connected to MongoDB');
  })
  .catch((err) => {
    logger.error({ err: err.message }, 'Worker MongoDB connection failed');
    process.exit(1);
  });

// Create BullMQ worker - use same queue name and connection as API
const QUEUE_NAME = QUEUE_NAMES.INSPECTION_PROCESS;

logger.info({ queueName: QUEUE_NAME }, 'Creating BullMQ worker...');

let worker;
try {
  // Use the shared Redis connection from queue config
  const redisConnection = getRedisConnection();
  logger.info('Got Redis connection for worker');

  worker = new Worker(
    QUEUE_NAME,
    processInspectionJob,
    {
      connection: redisConnection,
      concurrency: 2,
    }
  );
  logger.info('Worker created successfully');
} catch (err) {
  logger.error({ err: err.message, stack: err.stack }, 'FATAL: Failed to create worker');
  process.exit(1);
}

worker.on('ready', () => {
  logger.info({ queueName: QUEUE_NAME }, 'Worker is ready and listening for jobs');
});

worker.on('active', (job) => {
  logger.info({ jobId: job.data.jobId, bullmqId: job.id }, 'Worker picked up job');
});

worker.on('completed', (job, result) => {
  logger.info({ jobId: job.data.jobId, result }, 'Worker completed job');
});

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.data?.jobId, err: err.message }, 'Worker job failed');
});

worker.on('error', (err) => {
  logger.error({ err: err.message }, 'Worker error');
});

worker.on('stalled', (jobId) => {
  logger.warn({ jobId }, 'Worker job stalled');
});

logger.info({ 
  queueName: QUEUE_NAME,
  redisUrl: redisUrl.replace(/:[^:@]+@/, ':***@'), // Hide password in logs
}, 'BullMQ inspection worker starting...');

// Log connection status after a short delay
setTimeout(async () => {
  try {
    const isRunning = await worker.isRunning();
    logger.info({ isRunning, queueName: QUEUE_NAME }, 'Worker status check');
  } catch (e) {
    logger.error({ err: e.message }, 'Failed to check worker status');
  }
}, 5000);

process.on('SIGINT', async () => {
  logger.info('Worker received SIGINT, closing...');
  await worker.close();
  await pubClient.quit();
  await mongoose.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Worker received SIGTERM, closing...');
  await worker.close();
  await pubClient.quit();
  await mongoose.disconnect();
  process.exit(0);
});
