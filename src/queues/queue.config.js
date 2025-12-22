/**
 * BullMQ Queue Configuration
 * 
 * Central configuration for all job queues using BullMQ + Redis.
 * Replaces RabbitMQ with a simpler, Node.js-native solution.
 * 
 * @module queues/config
 */

const { Queue, Worker, QueueEvents } = require('bullmq');
const Redis = require('ioredis');
const config = require('../config/config');
const logger = require('../config/logger');

/** @type {Redis|null} */
let redisConnection = null;

/** @type {Map<string, Queue>} */
const queues = new Map();

/** @type {Map<string, Worker>} */
const workers = new Map();

/** @type {Map<string, QueueEvents>} */
const queueEvents = new Map();

/**
 * Queue names
 */
const QUEUE_NAMES = {
  PHOTO_ANALYSIS: 'photo-analysis',
  INSPECTION_PROCESS: 'inspection-process',
  REPORT_GENERATION: 'report-generation',
  PDF_EXPORT: 'pdf-export',
};

/**
 * Default job options
 */
const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 1000,
  },
  removeOnComplete: {
    count: 100,
    age: 24 * 60 * 60, // 24 hours
  },
  removeOnFail: {
    count: 500,
    age: 7 * 24 * 60 * 60, // 7 days
  },
};

/**
 * Get Redis connection options
 * @returns {Object}
 */
const getRedisOptions = () => {
  const options = {
    host: config.redis.host,
    port: config.redis.port,
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
  };

  if (config.redis.password) {
    options.password = config.redis.password;
  }

  if (config.redis.tls) {
    options.tls = {};
  }

  return options;
};

/**
 * Get or create Redis connection (singleton)
 * @returns {Redis}
 */
const getRedisConnection = () => {
  if (redisConnection) return redisConnection;

  const options = getRedisOptions();
  redisConnection = new Redis(options);

  redisConnection.on('connect', () => {
    logger.info('Redis connected for BullMQ');
  });

  redisConnection.on('error', (error) => {
    logger.error({ error }, 'Redis connection error');
  });

  redisConnection.on('close', () => {
    logger.warn('Redis connection closed');
  });

  return redisConnection;
};

/**
 * Create a new queue
 * @param {string} name - Queue name
 * @param {Object} [options] - Queue options
 * @returns {Queue}
 */
const createQueue = (name, options = {}) => {
  if (queues.has(name)) {
    return queues.get(name);
  }

  const queue = new Queue(name, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      ...options.defaultJobOptions,
    },
    ...options,
  });

  queues.set(name, queue);
  logger.info({ queue: name }, 'Queue created');

  return queue;
};

/**
 * Create a worker for a queue
 * @param {string} queueName - Queue name
 * @param {Function} processor - Job processor function
 * @param {Object} [options] - Worker options
 * @returns {Worker}
 */
const createWorker = (queueName, processor, options = {}) => {
  const workerKey = `${queueName}-${Date.now()}`;
  
  const worker = new Worker(
    queueName,
    async (job) => {
      logger.debug({ jobId: job.id, queue: queueName, data: job.data }, 'Processing job');
      try {
        const result = await processor(job);
        logger.debug({ jobId: job.id, queue: queueName }, 'Job completed');
        return result;
      } catch (error) {
        logger.error({ jobId: job.id, queue: queueName, error: error.message }, 'Job failed');
        throw error;
      }
    },
    {
      connection: getRedisConnection(),
      concurrency: options.concurrency || 2,
      limiter: options.limiter,
      ...options,
    }
  );

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, queue: queueName }, 'Job completed successfully');
  });

  worker.on('failed', (job, error) => {
    logger.error({ jobId: job?.id, queue: queueName, error: error.message }, 'Job failed');
  });

  worker.on('error', (error) => {
    logger.error({ queue: queueName, error: error.message }, 'Worker error');
  });

  workers.set(workerKey, worker);
  logger.info({ queue: queueName, concurrency: options.concurrency || 2 }, 'Worker created');

  return worker;
};

/**
 * Get queue events for monitoring
 * @param {string} queueName - Queue name
 * @returns {QueueEvents}
 */
const getQueueEvents = (queueName) => {
  if (queueEvents.has(queueName)) {
    return queueEvents.get(queueName);
  }

  const events = new QueueEvents(queueName, {
    connection: getRedisConnection(),
  });

  queueEvents.set(queueName, events);
  return events;
};

/**
 * Add a job to a queue
 * @param {string} queueName - Queue name
 * @param {string} jobName - Job name/type
 * @param {Object} data - Job data
 * @param {Object} [options] - Job options
 * @returns {Promise<import('bullmq').Job>}
 */
const addJob = async (queueName, jobName, data, options = {}) => {
  const queue = createQueue(queueName);
  const job = await queue.add(jobName, data, options);
  logger.debug({ jobId: job.id, queue: queueName, jobName }, 'Job added to queue');
  return job;
};

/**
 * Get queue statistics
 * @param {string} queueName - Queue name
 * @returns {Promise<Object>}
 */
const getQueueStats = async (queueName) => {
  const queue = createQueue(queueName);
  
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  return {
    waiting,
    active,
    completed,
    failed,
    delayed,
    total: waiting + active + delayed,
  };
};

/**
 * Clean up old jobs
 * @param {string} queueName - Queue name
 * @param {number} [gracePeriod=0] - Grace period in milliseconds
 * @returns {Promise<void>}
 */
const cleanQueue = async (queueName, gracePeriod = 0) => {
  const queue = createQueue(queueName);
  await queue.clean(gracePeriod, 1000, 'completed');
  await queue.clean(gracePeriod, 1000, 'failed');
  logger.info({ queue: queueName }, 'Queue cleaned');
};

/**
 * Gracefully shutdown all workers and connections
 * @returns {Promise<void>}
 */
const shutdown = async () => {
  logger.info('Shutting down BullMQ...');

  // Close workers
  const workerPromises = Array.from(workers.values()).map((worker) => worker.close());
  await Promise.all(workerPromises);

  // Close queue events
  const eventPromises = Array.from(queueEvents.values()).map((events) => events.close());
  await Promise.all(eventPromises);

  // Close queues
  const queuePromises = Array.from(queues.values()).map((queue) => queue.close());
  await Promise.all(queuePromises);

  // Close Redis connection
  if (redisConnection) {
    await redisConnection.quit();
    redisConnection = null;
  }

  queues.clear();
  workers.clear();
  queueEvents.clear();

  logger.info('BullMQ shutdown complete');
};

/**
 * Health check for Redis connection
 * @returns {Promise<boolean>}
 */
const healthCheck = async () => {
  try {
    const redis = getRedisConnection();
    await redis.ping();
    return true;
  } catch (error) {
    logger.error({ error }, 'Redis health check failed');
    return false;
  }
};

module.exports = {
  QUEUE_NAMES,
  DEFAULT_JOB_OPTIONS,
  getRedisConnection,
  createQueue,
  createWorker,
  getQueueEvents,
  addJob,
  getQueueStats,
  cleanQueue,
  shutdown,
  healthCheck,
};

