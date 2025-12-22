const express = require('express');
const helmet = require('helmet');
const xss = require('xss-clean');
const mongoSanitize = require('express-mongo-sanitize');
const compression = require('compression');
const cors = require('cors');
const passport = require('passport');
const httpStatus = require('http-status');
const config = require('./config/config');
const morgan = require('./config/morgan');
const { jwtStrategy } = require('./config/passport');
const { authLimiter } = require('./middlewares/rateLimiter');
const routes = require('./routes/v1');
const { errorConverter, errorHandler } = require('./middlewares/error');
const ApiError = require('./utils/ApiError');
const { billingController } = require('./controllers');

const app = express();

if (config.env !== 'test') {
  app.use(morgan.successHandler);
  app.use(morgan.errorHandler);
}

// set security HTTP headers
app.use(helmet());

// stripe webhook endpoint (raw body required)
app.post('/v1/billing/webhook', express.raw({ type: 'application/json' }), billingController.handleWebhook);
app.post('/api/billing/webhook', express.raw({ type: 'application/json' }), billingController.handleWebhook);

// parse json request body
app.use(express.json({ limit: '200mb' }));

// parse urlencoded request body
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

// sanitize request data
app.use(xss());
app.use(mongoSanitize());

// gzip compression
app.use(compression());

// enable cors
const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    
    // Allow all origins in development
    if (config.frontendUrl === '*') return callback(null, true);
    
    // Allow exact match
    if (origin === config.frontendUrl) return callback(null, true);
    
    // Allow Cloudflare Pages preview deployments (*.inspectai-8p7.pages.dev)
    if (/^https:\/\/[a-z0-9-]+\.inspectai-8p7\.pages\.dev$/.test(origin)) {
      return callback(null, true);
    }
    
    // Allow localhost for development
    if (/^http:\/\/localhost:\d+$/.test(origin)) {
      return callback(null, true);
    }
    
    callback(new Error('CORS not allowed'), false);
  },
  credentials: true,
};
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// jwt authentication
app.use(passport.initialize());
passport.use('jwt', jwtStrategy);

// limit repeated failed requests to auth endpoints
if (config.env === 'production') {
  app.use(['/v1/auth', '/api/auth'], authLimiter);
}

// v1 api routes
app.use('/v1', routes);
app.use('/api', routes);

app.get('/health', (req, res) => {
  res.send({ status: 'ok' });
});

// send back a 404 error for any unknown api request
app.use((req, res, next) => {
  next(new ApiError(httpStatus.NOT_FOUND, 'Not found'));
});

// convert error to ApiError, if needed
app.use(errorConverter);

// handle error
app.use(errorHandler);

module.exports = app;
