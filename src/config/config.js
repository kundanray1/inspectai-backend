const dotenv = require('dotenv');
const path = require('path');
const Joi = require('joi');

dotenv.config({ path: path.join(__dirname, '../../.env') });

const envVarsSchema = Joi.object()
  .keys({
    NODE_ENV: Joi.string().valid('production', 'development', 'test').required(),
    PORT: Joi.number().default(3000),
    MONGODB_URL: Joi.string().required().description('Mongo DB url'),
    JWT_SECRET: Joi.string().required().description('JWT secret key'),
    JWT_ACCESS_EXPIRATION_MINUTES: Joi.number().default(30).description('minutes after which access tokens expire'),
    JWT_REFRESH_EXPIRATION_DAYS: Joi.number().default(30).description('days after which refresh tokens expire'),
    JWT_RESET_PASSWORD_EXPIRATION_MINUTES: Joi.number()
      .default(10)
      .description('minutes after which reset password token expires'),
    JWT_VERIFY_EMAIL_EXPIRATION_MINUTES: Joi.number()
      .default(10)
      .description('minutes after which verify email token expires'),
    SMTP_HOST: Joi.string().description('server that will send the emails'),
    SMTP_PORT: Joi.number().description('port to connect to the email server'),
    SMTP_USERNAME: Joi.string().description('username for email server'),
    SMTP_PASSWORD: Joi.string().description('password for email server'),
    EMAIL_FROM: Joi.string().description('the from field in the emails sent by the app'),
    FRONTEND_URL: Joi.string().uri().description('Allowed frontend origin for CORS'),
    UPLOAD_DIR: Joi.string().default('backend/uploads').description('Relative path for uploads storage'),
    SUPER_ADMIN_EMAIL: Joi.string().email().default('raykundan57@gmail.com').description('Initial super admin email'),
    SUPER_ADMIN_PASSWORD: Joi.string().allow('').description('Initial super admin password (optional, random if omitted)'),
    SUPER_ADMIN_NAME: Joi.string().default('Ray Kundan').description('Initial super admin display name'),
    STRIPE_SECRET_KEY: Joi.string().description('Stripe secret API key'),
    STRIPE_PRICE_STARTER: Joi.string().description('Stripe price id for starter plan'),
    STRIPE_PRICE_PRO: Joi.string().description('Stripe price id for pro plan'),
    STRIPE_BILLING_RETURN_URL: Joi.string().uri().description('Return URL after billing portal/checkout'),
    STRIPE_WEBHOOK_SECRET: Joi.string().description('Stripe webhook signing secret'),
    RABBITMQ_URL: Joi.string().default('amqp://localhost:5672').description('AMQP connection string (deprecated)'),
    RABBITMQ_PREFETCH: Joi.number().integer().min(1).default(5).description('RabbitMQ prefetch count (deprecated)'),
    RABBITMQ_AUTO_START: Joi.boolean()
      .truthy('true')
      .truthy('1')
      .falsy('false')
      .falsy('0')
      .default(true)
      .description('Attempt to auto-start local RabbitMQ via Docker (deprecated)'),
    // Redis Configuration (for BullMQ)
    REDIS_URL: Joi.string().default('redis://localhost:6379').description('Redis connection URL'),
    REDIS_HOST: Joi.string().default('localhost').description('Redis host'),
    REDIS_PORT: Joi.number().integer().default(6379).description('Redis port'),
    REDIS_PASSWORD: Joi.string().allow('').description('Redis password'),
    REDIS_TLS: Joi.boolean()
      .truthy('true')
      .truthy('1')
      .falsy('false')
      .falsy('0')
      .default(false)
      .description('Enable TLS for Redis connection'),
    OLLAMA_URL: Joi.string().uri().default('http://localhost:11434').description('Base URL for local Ollama instance'),
    OLLAMA_MODEL_SCHEMA: Joi.string().default('llama3.1').description('Ollama model for schema extraction'),
    OLLAMA_MODEL_INSPECTION: Joi.string().default('llama3.1').description('Ollama model for inspection generation'),
    OLLAMA_TIMEOUT_MS: Joi.number().integer().min(1000).default(120000).description('Timeout for Ollama requests'),
    // Gemini AI Configuration
    GEMINI_API_KEY: Joi.string().description('Google Gemini API key'),
    GEMINI_MODEL: Joi.string().default('gemini-2.5-flash').description('Gemini model to use'),
    GEMINI_VISION_MODEL: Joi.string().default('gemini-2.5-flash').description('Gemini vision model for image analysis'),
    GEMINI_RATE_LIMIT_RPM: Joi.number().integer().min(1).default(15).description('Gemini API rate limit (requests per minute)'),
    GEMINI_TIMEOUT_MS: Joi.number().integer().min(1000).default(60000).description('Timeout for Gemini requests'),
    GEMINI_MAX_RETRIES: Joi.number().integer().min(0).default(3).description('Maximum retry attempts for Gemini requests'),
    // Cloudflare R2 Storage Configuration
    CLOUDFLARE_ACCOUNT_ID: Joi.string().description('Cloudflare account ID'),
    CLOUDFLARE_R2_ACCESS_KEY: Joi.string().description('R2 access key ID'),
    CLOUDFLARE_R2_SECRET_KEY: Joi.string().description('R2 secret access key'),
    CLOUDFLARE_R2_BUCKET: Joi.string().default('inspectai').description('R2 bucket name'),
    CLOUDFLARE_R2_PUBLIC_URL: Joi.string().uri().description('Public URL for R2 bucket (if using custom domain)'),
    STORAGE_PROVIDER: Joi.string().valid('local', 'r2', 's3').default('local').description('Storage provider to use'),
    INSPECTION_QUEUE_EXCHANGE: Joi.string().default('inspectai.inspection').description('Inspection queue exchange name'),
    INSPECTION_QUEUE_NAME: Joi.string().default('inspectai.inspection.analysis').description('Inspection queue name'),
    INSPECTION_QUEUE_ROUTING_KEY: Joi.string().default('inspection.analysis').description('Inspection queue routing key'),
    INSPECTION_QUEUE_MAX_PENDING: Joi.number()
      .integer()
      .min(0)
      .default(500)
      .description('Maximum pending inspection jobs before applying backpressure'),
    INSPECTION_WORKER_PREFETCH: Joi.number().integer().min(1).default(5).description('Prefetch count per inspection worker'),
    INSPECTION_WORKER_CONCURRENCY: Joi.number()
      .integer()
      .min(1)
      .default(2)
      .description('Number of inspection worker instances'),
  })
  .unknown();

const { value: envVars, error } = envVarsSchema.prefs({ errors: { label: 'key' } }).validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

module.exports = {
  env: envVars.NODE_ENV,
  port: envVars.PORT,
  mongoose: {
    url: envVars.MONGODB_URL + (envVars.NODE_ENV === 'test' ? '-test' : ''),
    options: {
      // Options removed - these are default in Mongoose 6+
      // useCreateIndex, useNewUrlParser, useUnifiedTopology are no longer needed
    },
  },
  jwt: {
    secret: envVars.JWT_SECRET,
    accessExpirationMinutes: envVars.JWT_ACCESS_EXPIRATION_MINUTES,
    refreshExpirationDays: envVars.JWT_REFRESH_EXPIRATION_DAYS,
    resetPasswordExpirationMinutes: envVars.JWT_RESET_PASSWORD_EXPIRATION_MINUTES,
    verifyEmailExpirationMinutes: envVars.JWT_VERIFY_EMAIL_EXPIRATION_MINUTES,
  },
  email: {
    smtp: {
      host: envVars.SMTP_HOST,
      port: envVars.SMTP_PORT,
      auth: {
        user: envVars.SMTP_USERNAME,
        pass: envVars.SMTP_PASSWORD,
      },
    },
    from: envVars.EMAIL_FROM,
  },
  frontendUrl: envVars.FRONTEND_URL || '*',
  uploads: {
    dir: envVars.UPLOAD_DIR,
  },
  superAdmin: {
    email: envVars.SUPER_ADMIN_EMAIL,
    password: envVars.SUPER_ADMIN_PASSWORD,
    name: envVars.SUPER_ADMIN_NAME || 'Super Admin',
  },
  stripe: {
    secretKey: envVars.STRIPE_SECRET_KEY,
    priceStarter: envVars.STRIPE_PRICE_STARTER,
    pricePro: envVars.STRIPE_PRICE_PRO,
    returnUrl: envVars.STRIPE_BILLING_RETURN_URL,
    webhookSecret: envVars.STRIPE_WEBHOOK_SECRET,
  },
  rabbitmq: {
    url: envVars.RABBITMQ_URL,
    prefetch: envVars.RABBITMQ_PREFETCH,
    autoStart: envVars.RABBITMQ_AUTO_START,
  },
  redis: {
    url: envVars.REDIS_URL,
    host: envVars.REDIS_HOST,
    port: envVars.REDIS_PORT,
    password: envVars.REDIS_PASSWORD || undefined,
    tls: envVars.REDIS_TLS,
  },
  ollama: {
    url: envVars.OLLAMA_URL,
    schemaModel: envVars.OLLAMA_MODEL_SCHEMA,
    inspectionModel: envVars.OLLAMA_MODEL_INSPECTION,
    timeoutMs: envVars.OLLAMA_TIMEOUT_MS,
  },
  gemini: {
    apiKey: envVars.GEMINI_API_KEY,
    model: envVars.GEMINI_MODEL,
    visionModel: envVars.GEMINI_VISION_MODEL,
    rateLimitRpm: envVars.GEMINI_RATE_LIMIT_RPM,
    timeoutMs: envVars.GEMINI_TIMEOUT_MS,
    maxRetries: envVars.GEMINI_MAX_RETRIES,
  },
  storage: {
    provider: envVars.STORAGE_PROVIDER,
    r2: {
      accountId: envVars.CLOUDFLARE_ACCOUNT_ID,
      accessKeyId: envVars.CLOUDFLARE_R2_ACCESS_KEY,
      secretAccessKey: envVars.CLOUDFLARE_R2_SECRET_KEY,
      bucket: envVars.CLOUDFLARE_R2_BUCKET,
      publicUrl: envVars.CLOUDFLARE_R2_PUBLIC_URL,
    },
  },
  queues: {
    inspection: {
      exchange: envVars.INSPECTION_QUEUE_EXCHANGE,
      queue: envVars.INSPECTION_QUEUE_NAME,
      routingKey: envVars.INSPECTION_QUEUE_ROUTING_KEY,
      maxPending: envVars.INSPECTION_QUEUE_MAX_PENDING,
      prefetch: envVars.INSPECTION_WORKER_PREFETCH,
      concurrency: envVars.INSPECTION_WORKER_CONCURRENCY,
    },
  },
};
