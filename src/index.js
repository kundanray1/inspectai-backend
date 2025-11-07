const mongoose = require('mongoose');
const app = require('./app');
const config = require('./config/config');
const logger = require('./config/logger');
const { ensureSuperAdmin } = require('./utils/bootstrap');
const { ensureDefaultPlans } = require('./services/plan.service');
const { initRabbitMQ, closeRabbitMQ } = require('./lib/rabbitmq');
const { initSocket } = require('./lib/socket');

let server;
mongoose.connect(config.mongoose.url, config.mongoose.options).then(async () => {
  logger.info('Connected to MongoDB');
  await ensureSuperAdmin();
  await ensureDefaultPlans();
  await initRabbitMQ();
  server = app.listen(config.port, () => {
    logger.info(`Listening to port ${config.port}`);
  });
  initSocket(server);
});

const exitHandler = async () => {
  try {
    await closeRabbitMQ();
  } catch (error) {
    logger.error({ err: error }, 'Error closing RabbitMQ connection');
  }
  if (server) {
    server.close(() => {
      logger.info('Server closed');
      process.exit(1);
    });
  } else {
    process.exit(1);
  }
};

const unexpectedErrorHandler = (error) => {
  logger.error(error);
  exitHandler().catch(() => process.exit(1));
};

process.on('uncaughtException', unexpectedErrorHandler);
process.on('unhandledRejection', unexpectedErrorHandler);

process.on('SIGTERM', () => {
  logger.info('SIGTERM received');
  if (server) {
    server.close();
  }
  closeRabbitMQ().catch((err) => logger.error({ err }, 'Error closing RabbitMQ connection after SIGTERM'));
});
