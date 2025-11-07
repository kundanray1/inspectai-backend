const { Server } = require('socket.io');
const config = require('../config/config');
const logger = require('../config/logger');

let io;

const buildCorsOptions = () => {
  if (config.frontendUrl === '*' || !config.frontendUrl) {
    return { origin: '*', credentials: true };
  }
  return { origin: config.frontendUrl, credentials: true };
};

const initSocket = (server) => {
  if (io) {
    return io;
  }

  io = new Server(server, {
    cors: buildCorsOptions(),
    path: '/socket.io',
  });

  const inspectionNamespace = io.of('/inspections');

  inspectionNamespace.on('connection', (socket) => {
    const { inspectionId } = socket.handshake.query;
    if (inspectionId) {
      socket.join(`inspection:${inspectionId}`);
      logger.info({ inspectionId }, 'Socket joined inspection room');
    }

    socket.on('join-inspection', (payload) => {
      if (payload && payload.inspectionId) {
        socket.join(`inspection:${payload.inspectionId}`);
      }
    });
  });

  logger.info('Socket.io initialised');
  return io;
};

const getIO = () => {
  if (!io) {
    throw new Error('Socket.io has not been initialised');
  }
  return io;
};

const emitInspectionEvent = (inspectionId, event, payload) => {
  if (!io || !inspectionId) {
    return;
  }
  const namespace = io.of('/inspections');
  namespace.to(`inspection:${inspectionId}`).emit(event, payload);
};

module.exports = {
  initSocket,
  getIO,
  emitInspectionEvent,
};
