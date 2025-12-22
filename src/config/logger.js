const winston = require('winston');
const config = require('./config');

const enumerateErrorFormat = winston.format((info) => {
  if (info instanceof Error) {
    Object.assign(info, { message: info.stack });
  }
  // Handle objects with err or error properties
  if (info.err && info.err instanceof Error) {
    info.message = `${info.message || ''} - ${info.err.stack || info.err.message}`;
  }
  if (info.error && info.error instanceof Error) {
    info.message = `${info.message || ''} - ${info.error.stack || info.error.message}`;
  }
  // Handle direct object logging
  if (typeof info.message === 'object') {
    info.message = JSON.stringify(info.message, null, 2);
  }
  return info;
});

const logger = winston.createLogger({
  level: config.env === 'development' ? 'debug' : 'info',
  format: winston.format.combine(
    enumerateErrorFormat(),
    config.env === 'development' ? winston.format.colorize() : winston.format.uncolorize(),
    winston.format.splat(),
    winston.format.printf(({ level, message, err, error }) => {
      let output = `${level}: ${message}`;
      if (err) output += `\n${err.stack || err.message || JSON.stringify(err)}`;
      if (error) output += `\n${error.stack || error.message || JSON.stringify(error)}`;
      return output;
    })
  ),
  transports: [
    new winston.transports.Console({
      stderrLevels: ['error'],
    }),
  ],
});

module.exports = logger;
