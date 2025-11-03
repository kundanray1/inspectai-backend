const amqplib = require('amqplib');
const { spawnSync } = require('child_process');
const path = require('path');
const config = require('../config/config');
const logger = require('../config/logger');

let connection;
let channel;

const startLocalBroker = async () => {
  const projectRoot = path.resolve(__dirname, '..', '..');
  const composeArgs = ['compose', 'up', '-d', 'rabbitmq'];

  const run = (cmd) => {
    // eslint-disable-next-line security/detect-child-process
    const result = spawnSync(cmd, composeArgs, {
      cwd: projectRoot,
      stdio: 'inherit',
    });
    return result.status === 0;
  };

  if (run('docker')) {
    logger.info('RabbitMQ docker container ensured via `docker compose`');
    return;
  }

  if (run('docker-compose')) {
    logger.info('RabbitMQ docker container ensured via `docker-compose`');
    return;
  }

  logger.warn('Unable to automatically start RabbitMQ docker container');
};

const createConnection = async () => {
  if (connection) {
    return connection;
  }

  try {
    connection = await amqplib.connect(config.rabbitmq.url);
    connection.on('error', (err) => {
      logger.error({ err }, 'RabbitMQ connection error');
    });
    connection.on('close', () => {
      logger.warn('RabbitMQ connection closed');
      connection = null;
      channel = null;
    });
    logger.info({ url: config.rabbitmq.url }, 'Connected to RabbitMQ');
    return connection;
  } catch (error) {
    logger.error({ err: error }, 'Failed to connect to RabbitMQ');
    if (config.rabbitmq.autoStart) {
      logger.info('Attempting to auto-start local RabbitMQ via Docker');
      await startLocalBroker();
      connection = await amqplib.connect(config.rabbitmq.url);
      logger.info({ url: config.rabbitmq.url }, 'Connected to RabbitMQ after auto-start');
      connection.on('error', (err) => {
        logger.error({ err }, 'RabbitMQ connection error');
      });
      connection.on('close', () => {
        logger.warn('RabbitMQ connection closed');
        connection = null;
        channel = null;
      });
      return connection;
    }
    throw error;
  }
};

const initRabbitMQ = async () => {
  if (channel) {
    return channel;
  }

  const conn = await createConnection();
  channel = await conn.createChannel();
  if (config.rabbitmq.prefetch) {
    await channel.prefetch(config.rabbitmq.prefetch);
  }
  logger.info({ prefetch: config.rabbitmq.prefetch }, 'RabbitMQ channel ready');
  return channel;
};

const getChannel = () => {
  if (!channel) {
    throw new Error('RabbitMQ channel has not been initialised');
  }
  return channel;
};

const publishMessage = async ({ exchange, routingKey, message, options = {} }) => {
  const ch = channel || (await initRabbitMQ());
  await ch.assertExchange(exchange, 'topic', { durable: true });
  const payload = Buffer.from(JSON.stringify(message));
  ch.publish(exchange, routingKey, payload, {
    contentType: 'application/json',
    persistent: true,
    ...options,
  });
};

const closeRabbitMQ = async () => {
  if (channel) {
    await channel.close();
    channel = null;
  }
  if (connection) {
    await connection.close();
    connection = null;
  }
};

module.exports = {
  initRabbitMQ,
  getChannel,
  publishMessage,
  closeRabbitMQ,
};
