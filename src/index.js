const mongoose = require('mongoose');
const app = require('./app');
const config = require('./config/config');
const logger = require('./config/logger');
const { ensureSuperAdmin } = require('./utils/bootstrap');
const { ensureDefaultPlans } = require('./services/plan.service');
const { initSocket } = require('./lib/socket');

// Optional RabbitMQ (legacy) - only init if configured and not using BullMQ
let rabbitmqModule = null;
const useRabbitMQ = config.rabbitmq?.url && !config.redis?.url;

let server;

const startServer = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect(config.mongoose.url, config.mongoose.options);
    logger.info('Connected to MongoDB');

    // Bootstrap data
    await ensureSuperAdmin();
    await ensureDefaultPlans();

    // Initialize legacy RabbitMQ if configured (skip if using BullMQ/Redis)
    if (useRabbitMQ) {
      try {
        rabbitmqModule = require('./lib/rabbitmq');
        await rabbitmqModule.initRabbitMQ();
        logger.info('RabbitMQ initialized');
      } catch (err) {
        logger.warn({ err }, 'RabbitMQ initialization failed (non-critical if using BullMQ)');
      }
    } else {
      logger.info('Using BullMQ with Redis for job processing');
    }

    // Start HTTP server
    const port = process.env.PORT || config.port;
    server = app.listen(port, '0.0.0.0', () => {
      logger.info(`Server listening on port ${port}`);
      logger.info(`Environment: ${config.env}`);
      logger.info(`API docs available at /v1/docs`);
    });

    // Initialize WebSocket
    initSocket(server);

  } catch (error) {
    logger.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }
};

const exitHandler = async () => {
  try {
    // Close RabbitMQ if it was initialized
    if (rabbitmqModule) {
      await rabbitmqModule.closeRabbitMQ();
    }
  } catch (error) {
    logger.error({ err: error }, 'Error during cleanup');
  }

  if (server) {
    server.close(() => {
      logger.info('Server closed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
};

const unexpectedErrorHandler = (error) => {
  logger.error({ err: error }, 'Unexpected error');
  exitHandler().catch(() => process.exit(1));
};

process.on('uncaughtException', unexpectedErrorHandler);
process.on('unhandledRejection', unexpectedErrorHandler);

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  exitHandler();
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  exitHandler();
});

// Start the server
startServer();
