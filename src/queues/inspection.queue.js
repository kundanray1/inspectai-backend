const httpStatus = require('http-status');
const config = require('../config/config');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');
const { initRabbitMQ, getChannel } = require('../lib/rabbitmq');
const { jobService } = require('../services');

const EXCHANGE = config.queues.inspection.exchange;
const QUEUE = config.queues.inspection.queue;
const ROUTING_KEY = config.queues.inspection.routingKey;

let setupPromise;

const ensureQueue = async () => {
  if (!setupPromise) {
    setupPromise = (async () => {
      const channel = await initRabbitMQ();
      await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      await channel.assertQueue(QUEUE, {
        durable: true,
        maxPriority: 10,
      });
      await channel.bindQueue(QUEUE, EXCHANGE, ROUTING_KEY);
      logger.info({ queue: QUEUE, exchange: EXCHANGE }, 'Inspection queue ready');
      return channel;
    })().catch((error) => {
      setupPromise = null;
      throw error;
    });
  }
  return setupPromise;
};

const checkQueueDepth = async () => {
  const channel = getChannel();
  const stats = await channel.checkQueue(QUEUE);
  const { messageCount, consumerCount } = stats;
  return {
    messageCount,
    consumerCount,
  };
};

const publishInspectionJob = async ({ job, payload }) => {
  await ensureQueue();
  const channel = getChannel();

  const stats = await checkQueueDepth().catch((error) => {
    logger.warn({ err: error }, 'Failed to read inspection queue depth');
    return { messageCount: 0, consumerCount: 0 };
  });

  if (config.queues.inspection.maxPending && stats.messageCount >= config.queues.inspection.maxPending) {
    logger.warn({ queueDepth: stats.messageCount }, 'Inspection queue saturated, rejecting new job');
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Inspection queue is busy, please retry later');
  }

  await jobService.markJobQueued({ jobId: job._id, queueDepth: stats.messageCount });

  channel.publish(
    EXCHANGE,
    ROUTING_KEY,
    Buffer.from(
      JSON.stringify({
        jobId: job._id,
        inspectionId: job.inspectionId,
        organizationId: job.organizationId,
        payload,
      })
    ),
    {
      contentType: 'application/json',
      persistent: true,
    }
  );

  logger.info({ jobId: job._id, queueDepth: stats.messageCount + 1 }, 'Published inspection job');

  return { jobId: job._id, queueDepth: stats.messageCount + 1 };
};

const consumeInspectionJobs = async (handler) => {
  const channel = await ensureQueue();
  const { prefetch } = config.queues.inspection;
  if (prefetch) {
    await channel.prefetch(prefetch);
  }

  const consumer = await channel.consume(
    QUEUE,
    async (message) => {
      if (!message) {
        return;
      }

      const ack = () => channel.ack(message);
      const nack = ({ requeue } = { requeue: false }) => channel.nack(message, false, requeue);

      let payload;
      try {
        payload = JSON.parse(message.content.toString());
      } catch (error) {
        logger.error({ err: error }, 'Failed to parse inspection job payload, discarding');
        ack();
        return;
      }

      try {
        await handler(payload, { ack, nack });
      } catch (error) {
        logger.error({ err: error }, 'Inspection job handler threw an error');
        try {
          await jobService.markJobFailed({ jobId: payload.jobId, error });
        } catch (markError) {
          logger.error({ err: markError }, 'Failed to mark job as failed');
        }
        nack({ requeue: false });
      }
    },
    { noAck: false }
  );

  logger.info({ consumerTag: consumer.consumerTag, prefetch }, 'Inspection queue consumer registered');
  return consumer;
};

module.exports = {
  ensureQueue,
  publishInspectionJob,
  consumeInspectionJobs,
  checkQueueDepth,
  EXCHANGE,
  QUEUE,
  ROUTING_KEY,
};
