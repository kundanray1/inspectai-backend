/**
 * Gemini AI Service
 * 
 * Provides a rate-limited, retry-enabled client for Google Gemini API.
 * Supports both text and vision (multimodal) requests.
 * 
 * @module services/ai/gemini
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const httpStatus = require('http-status');
const config = require('../../config/config');
const logger = require('../../config/logger');
const ApiError = require('../../utils/ApiError');

/**
 * @typedef {Object} RateLimiter
 * @property {number[]} timestamps - Array of request timestamps
 * @property {number} maxRequests - Maximum requests per window
 * @property {number} windowMs - Time window in milliseconds
 */

/**
 * @typedef {Object} GeminiResponse
 * @property {string} text - The generated text response
 * @property {Object} [usage] - Token usage information
 * @property {string} [finishReason] - Reason for completion
 */

/**
 * @typedef {Object} ImagePart
 * @property {string} mimeType - Image MIME type (e.g., 'image/jpeg')
 * @property {string} data - Base64 encoded image data
 */

// Rate limiter state
const rateLimiter = {
  timestamps: [],
  maxRequests: config.gemini.rateLimitRpm || 15,
  windowMs: 60 * 1000, // 1 minute
};

/**
 * Check if we can make a request within rate limits
 * @returns {boolean} Whether request is allowed
 */
const canMakeRequest = () => {
  const now = Date.now();
  // Remove timestamps outside the window
  rateLimiter.timestamps = rateLimiter.timestamps.filter(
    (timestamp) => now - timestamp < rateLimiter.windowMs
  );
  return rateLimiter.timestamps.length < rateLimiter.maxRequests;
};

/**
 * Record a request timestamp for rate limiting
 */
const recordRequest = () => {
  rateLimiter.timestamps.push(Date.now());
};

/**
 * Calculate wait time until next available request slot
 * @returns {number} Milliseconds to wait
 */
const getWaitTime = () => {
  if (rateLimiter.timestamps.length === 0) return 0;
  const oldestTimestamp = rateLimiter.timestamps[0];
  const waitTime = rateLimiter.windowMs - (Date.now() - oldestTimestamp);
  return Math.max(0, waitTime);
};

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Initialize Gemini client
 * @returns {GoogleGenerativeAI|null}
 */
const getClient = () => {
  if (!config.gemini.apiKey) {
    logger.warn('Gemini API key not configured');
    return null;
  }
  return new GoogleGenerativeAI(config.gemini.apiKey);
};

/**
 * Make a request with retry logic and rate limiting
 * @param {Function} requestFn - The request function to execute
 * @param {Object} options - Options
 * @param {number} [options.maxRetries] - Maximum retry attempts
 * @param {number} [options.retryDelay] - Initial retry delay in ms
 * @returns {Promise<*>} Request result
 */
const withRetry = async (requestFn, options = {}) => {
  const maxRetries = options.maxRetries ?? config.gemini.maxRetries ?? 3;
  const baseDelay = options.retryDelay ?? 1000;
  
  let lastError;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // Wait for rate limit if needed
      while (!canMakeRequest()) {
        const waitTime = getWaitTime();
        logger.debug({ waitTime }, 'Rate limit reached, waiting...');
        // eslint-disable-next-line no-await-in-loop
        await sleep(waitTime + 100);
      }
      
      recordRequest();
      // eslint-disable-next-line no-await-in-loop
      return await requestFn();
    } catch (error) {
      lastError = error;
      
      // Don't retry on client errors (4xx)
      if (error.status >= 400 && error.status < 500 && error.status !== 429) {
        throw error;
      }
      
      // Calculate exponential backoff
      const delay = baseDelay * Math.pow(2, attempt);
      
      if (attempt < maxRetries) {
        logger.warn(
          { attempt: attempt + 1, maxRetries, delay, error: error.message },
          'Gemini request failed, retrying...'
        );
        // eslint-disable-next-line no-await-in-loop
        await sleep(delay);
      }
    }
  }
  
  logger.error({ error: lastError }, 'Gemini request failed after all retries');
  throw new ApiError(
    httpStatus.BAD_GATEWAY,
    `Gemini API request failed: ${lastError.message}`
  );
};

/**
 * Generate text completion using Gemini
 * @param {Object} params - Request parameters
 * @param {string} params.prompt - The text prompt
 * @param {string} [params.model] - Model to use (defaults to config)
 * @param {Object} [params.generationConfig] - Generation configuration
 * @returns {Promise<GeminiResponse>}
 */
const generateText = async ({ prompt, model, generationConfig = {} }) => {
  const client = getClient();
  if (!client) {
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Gemini AI service not configured');
  }
  
  const modelName = model || config.gemini.model;
  const genModel = client.getGenerativeModel({ model: modelName });
  
  logger.debug({ model: modelName, promptLength: prompt.length }, 'Generating text with Gemini');
  
  const result = await withRetry(async () => {
    const response = await genModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 8192,
        ...generationConfig,
      },
    });
    return response;
  });
  
  const response = result.response;
  const text = response.text();
  
  logger.debug({ responseLength: text.length }, 'Gemini text generation complete');
  
  return {
    text,
    usage: response.usageMetadata,
    finishReason: response.candidates?.[0]?.finishReason,
  };
};

/**
 * Generate content with vision (image analysis)
 * @param {Object} params - Request parameters
 * @param {string} params.prompt - The text prompt
 * @param {ImagePart[]} params.images - Array of image parts
 * @param {string} [params.model] - Model to use
 * @param {Object} [params.generationConfig] - Generation configuration
 * @returns {Promise<GeminiResponse>}
 */
const generateWithVision = async ({ prompt, images, model, generationConfig = {} }) => {
  const client = getClient();
  if (!client) {
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Gemini AI service not configured');
  }
  
  const modelName = model || config.gemini.visionModel;
  const genModel = client.getGenerativeModel({ model: modelName });
  
  logger.debug(
    { model: modelName, promptLength: prompt.length, imageCount: images.length },
    'Generating content with vision'
  );
  
  // Build parts array with text and images
  const parts = [
    { text: prompt },
    ...images.map((img) => ({
      inlineData: {
        mimeType: img.mimeType,
        data: img.data,
      },
    })),
  ];
  
  const result = await withRetry(async () => {
    const response = await genModel.generateContent({
      contents: [{ role: 'user', parts }],
      generationConfig: {
        temperature: 0.4,
        topK: 32,
        topP: 0.95,
        maxOutputTokens: 8192,
        ...generationConfig,
      },
    });
    return response;
  });
  
  const response = result.response;
  const text = response.text();
  
  logger.debug({ responseLength: text.length }, 'Gemini vision generation complete');
  
  return {
    text,
    usage: response.usageMetadata,
    finishReason: response.candidates?.[0]?.finishReason,
  };
};

/**
 * Generate structured JSON output
 * @param {Object} params - Request parameters
 * @param {string} params.prompt - The text prompt (should ask for JSON)
 * @param {string} [params.model] - Model to use
 * @param {ImagePart[]} [params.images] - Optional images for vision
 * @returns {Promise<Object>} Parsed JSON response
 */
const generateJSON = async ({ prompt, model, images }) => {
  const enhancedPrompt = `${prompt}\n\nIMPORTANT: Respond with valid JSON only. Do not include any markdown formatting, code blocks, or explanatory text. Just the raw JSON object.`;
  
  let response;
  if (images && images.length > 0) {
    response = await generateWithVision({
      prompt: enhancedPrompt,
      images,
      model,
      generationConfig: { temperature: 0.2 },
    });
  } else {
    response = await generateText({
      prompt: enhancedPrompt,
      model,
      generationConfig: { temperature: 0.2 },
    });
  }
  
  // Try to extract JSON from response
  let jsonText = response.text.trim();
  
  // Remove markdown code blocks if present
  if (jsonText.startsWith('```json')) {
    jsonText = jsonText.slice(7);
  } else if (jsonText.startsWith('```')) {
    jsonText = jsonText.slice(3);
  }
  if (jsonText.endsWith('```')) {
    jsonText = jsonText.slice(0, -3);
  }
  jsonText = jsonText.trim();
  
  try {
    return JSON.parse(jsonText);
  } catch (error) {
    logger.error({ error, rawResponse: response.text.slice(0, 500) }, 'Failed to parse JSON from Gemini response');
    throw new ApiError(httpStatus.BAD_GATEWAY, 'Gemini returned invalid JSON response');
  }
};

/**
 * Check if Gemini service is available
 * @returns {Promise<boolean>}
 */
const isAvailable = async () => {
  try {
    const client = getClient();
    if (!client) return false;
    
    const model = client.getGenerativeModel({ model: config.gemini.model });
    await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
      generationConfig: { maxOutputTokens: 5 },
    });
    return true;
  } catch (error) {
    logger.warn({ error: error.message }, 'Gemini service availability check failed');
    return false;
  }
};

/**
 * Get current rate limit status
 * @returns {Object} Rate limit status
 */
const getRateLimitStatus = () => {
  const now = Date.now();
  const activeRequests = rateLimiter.timestamps.filter(
    (timestamp) => now - timestamp < rateLimiter.windowMs
  ).length;
  
  return {
    remaining: rateLimiter.maxRequests - activeRequests,
    limit: rateLimiter.maxRequests,
    resetIn: getWaitTime(),
  };
};

module.exports = {
  generateText,
  generateWithVision,
  generateJSON,
  isAvailable,
  getRateLimitStatus,
};

