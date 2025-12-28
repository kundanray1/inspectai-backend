const { Server } = require('socket.io');
const Redis = require('ioredis');
const config = require('../config/config');
const logger = require('../config/logger');

let io;
let subClient;

const buildCorsOptions = () => {
  const origins = ['https://sitewise.pages.dev', 'http://localhost:5173', 'http://localhost:3000'];
  
  if (config.frontendUrl && config.frontendUrl !== '*') {
    origins.push(config.frontendUrl);
  }
  
  return { 
    origin: origins,
    credentials: true,
    methods: ['GET', 'POST'],
  };
};

const initSocket = (server) => {
  if (io) {
    return io;
  }

  io = new Server(server, {
    cors: buildCorsOptions(),
    path: '/socket.io',
    transports: ['websocket', 'polling'],
  });

  const inspectionNamespace = io.of('/inspections');

  inspectionNamespace.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'Client connected to inspections namespace');
    
    const { inspectionId } = socket.handshake.query;
    if (inspectionId) {
      socket.join(`inspection:${inspectionId}`);
      logger.info({ inspectionId, socketId: socket.id }, 'Socket joined inspection room');
    }

    socket.on('join-inspection', (payload) => {
      if (payload && payload.inspectionId) {
        socket.join(`inspection:${payload.inspectionId}`);
        logger.info({ inspectionId: payload.inspectionId, socketId: socket.id }, 'Socket joined inspection room via event');
      }
    });

    socket.on('leave-inspection', (payload) => {
      if (payload && payload.inspectionId) {
        socket.leave(`inspection:${payload.inspectionId}`);
        logger.info({ inspectionId: payload.inspectionId, socketId: socket.id }, 'Socket left inspection room');
      }
    });

    socket.on('disconnect', (reason) => {
      logger.info({ socketId: socket.id, reason }, 'Client disconnected');
    });
  });

  // Subscribe to Redis pub/sub for worker events
  setupRedisPubSub();

  logger.info('Socket.io initialized with Redis pub/sub');
  return io;
};

const setupRedisPubSub = () => {
  try {
    const redisUrl = config.redis?.url || process.env.REDIS_URL;
    if (!redisUrl) {
      logger.warn('Redis URL not configured, skipping pub/sub setup');
      return;
    }

    subClient = new Redis(redisUrl);
    
    subClient.on('error', (err) => {
      logger.error({ err: err.message }, 'Redis sub client error');
    });

    subClient.on('connect', () => {
      logger.info('Redis pub/sub subscriber connected');
    });

    // Subscribe to socket events channel
    subClient.subscribe('socket:events', (err) => {
      if (err) {
        logger.error({ err }, 'Failed to subscribe to socket:events');
        return;
      }
      logger.info('Subscribed to socket:events channel');
    });

    // Handle incoming messages from workers
    subClient.on('message', (channel, message) => {
      if (channel === 'socket:events' && io) {
        try {
          const { channel: room, event, payload } = JSON.parse(message);
          const namespace = io.of('/inspections');
          namespace.to(room).emit(event, payload);
          logger.debug({ room, event }, 'Relayed socket event from worker');
        } catch (err) {
          logger.error({ err, message }, 'Failed to parse/relay socket event');
        }
      }
    });
  } catch (err) {
    logger.error({ err }, 'Failed to setup Redis pub/sub');
  }
};

const getIO = () => {
  if (!io) {
    throw new Error('Socket.io has not been initialized');
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

const cleanup = async () => {
  if (subClient) {
    await subClient.quit();
  }
  if (io) {
    io.close();
  }
};

module.exports = {
  initSocket,
  getIO,
  emitInspectionEvent,
  cleanup,
};
