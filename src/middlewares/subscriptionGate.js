/**
 * Subscription Gate Middleware
 * 
 * Controls access to features based on subscription status and trial usage.
 * Implements the freemium model with 1 free report for new signups.
 * 
 * @module middlewares/subscriptionGate
 */

const httpStatus = require('http-status');
const { Subscription } = require('../models');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');

/**
 * Subscription status types
 */
const SUBSCRIPTION_STATUS = {
  ACTIVE: 'active',
  TRIALING: 'trialing',
  PAST_DUE: 'past_due',
  CANCELED: 'canceled',
};

/**
 * Feature access levels
 */
const FEATURE_ACCESS = {
  REPORT_GENERATION: 'report_generation',
  PHOTO_ANALYSIS: 'photo_analysis',
  PDF_EXPORT: 'pdf_export',
  TEMPLATE_CREATION: 'template_creation',
  API_ACCESS: 'api_access',
};

/**
 * Plan limits by tier
 */
const PLAN_LIMITS = {
  trial: {
    reportsPerMonth: 1,
    photosPerInspection: 20,
    templates: 1,
    pdfWatermark: true,
    apiAccess: false,
  },
  free: {
    reportsPerMonth: 1,
    photosPerInspection: 20,
    templates: 1,
    pdfWatermark: true,
    apiAccess: false,
  },
  starter: {
    reportsPerMonth: 25,
    photosPerInspection: 50,
    templates: 3,
    pdfWatermark: false,
    apiAccess: false,
  },
  pro: {
    reportsPerMonth: 100,
    photosPerInspection: 100,
    templates: -1, // Unlimited
    pdfWatermark: false,
    apiAccess: true,
  },
};

/**
 * Get user's current subscription
 * @param {string} organizationId - Organization ID
 * @returns {Promise<Object|null>}
 */
const getSubscription = async (organizationId) => {
  try {
    const subscription = await Subscription.findOne({ organizationId }).lean();
    return subscription;
  } catch (error) {
    logger.error({ error, organizationId }, 'Failed to fetch subscription');
    return null;
  }
};

/**
 * Check if subscription is active
 * @param {Object} subscription - Subscription object
 * @returns {boolean}
 */
const isSubscriptionActive = (subscription) => {
  if (!subscription) return false;
  return [SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.TRIALING].includes(subscription.status);
};

/**
 * Get plan limits for a subscription
 * @param {Object} subscription - Subscription object
 * @returns {Object}
 */
const getPlanLimits = (subscription) => {
  if (!subscription || !isSubscriptionActive(subscription)) {
    return PLAN_LIMITS.free;
  }
  return PLAN_LIMITS[subscription.plan] || PLAN_LIMITS.free;
};

/**
 * Get current period usage
 * @param {Object} subscription - Subscription object
 * @returns {Object}
 */
const getCurrentUsage = (subscription) => {
  if (!subscription || !subscription.usage || subscription.usage.length === 0) {
    return { totalReports: 0, totalPdfExports: 0 };
  }
  // Get the most recent usage period
  return subscription.usage[subscription.usage.length - 1];
};

/**
 * Check if user can generate a report
 * @param {Object} user - User object
 * @param {Object} subscription - Subscription object
 * @returns {{ allowed: boolean, reason?: string, requiresUpgrade?: boolean }}
 */
const canGenerateReport = (user, subscription) => {
  // Check if active subscription
  if (isSubscriptionActive(subscription)) {
    const limits = getPlanLimits(subscription);
    const usage = getCurrentUsage(subscription);
    
    if (limits.reportsPerMonth !== -1 && usage.totalReports >= limits.reportsPerMonth) {
      return {
        allowed: false,
        reason: `Monthly report limit reached (${limits.reportsPerMonth} reports)`,
        requiresUpgrade: true,
      };
    }
    return { allowed: true };
  }

  // Check free trial
  if (!user.trialStatus || !user.trialStatus.freeReportUsed) {
    return { allowed: true, isTrialReport: true };
  }

  // Trial used, no subscription
  return {
    allowed: false,
    reason: 'Free trial report already used. Please upgrade to continue.',
    requiresUpgrade: true,
  };
};

/**
 * Check if user can upload photos
 * @param {Object} user - User object
 * @param {Object} subscription - Subscription object
 * @param {number} currentPhotoCount - Current photos in inspection
 * @param {number} newPhotoCount - Photos being added
 * @returns {{ allowed: boolean, reason?: string, limit?: number }}
 */
const canUploadPhotos = (user, subscription, currentPhotoCount, newPhotoCount) => {
  const limits = getPlanLimits(subscription);
  const totalAfterUpload = currentPhotoCount + newPhotoCount;

  if (totalAfterUpload > limits.photosPerInspection) {
    return {
      allowed: false,
      reason: `Photo limit exceeded. Maximum ${limits.photosPerInspection} photos per inspection.`,
      limit: limits.photosPerInspection,
    };
  }

  return { allowed: true, limit: limits.photosPerInspection };
};

/**
 * Check if user can create a template
 * @param {Object} user - User object
 * @param {Object} subscription - Subscription object
 * @param {number} currentTemplateCount - Current template count
 * @returns {{ allowed: boolean, reason?: string, limit?: number }}
 */
const canCreateTemplate = (user, subscription, currentTemplateCount) => {
  const limits = getPlanLimits(subscription);

  // Unlimited templates
  if (limits.templates === -1) {
    return { allowed: true, limit: -1 };
  }

  if (currentTemplateCount >= limits.templates) {
    return {
      allowed: false,
      reason: `Template limit reached. Maximum ${limits.templates} templates allowed.`,
      limit: limits.templates,
    };
  }

  return { allowed: true, limit: limits.templates };
};

/**
 * Middleware: Require active subscription OR unused trial
 * Use for report generation endpoints
 */
const requireSubscriptionOrTrial = async (req, res, next) => {
  try {
    const { user } = req;
    if (!user) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Authentication required');
    }

    const subscription = await getSubscription(user.organizationId);
    const result = canGenerateReport(user, subscription);

    if (!result.allowed) {
      throw new ApiError(httpStatus.PAYMENT_REQUIRED, result.reason, {
        requiresUpgrade: result.requiresUpgrade,
        upgradeUrl: '/pricing',
      });
    }

    // Attach subscription info to request
    req.subscription = subscription;
    req.subscriptionLimits = getPlanLimits(subscription);
    req.isTrialReport = result.isTrialReport;

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware: Require active subscription
 * Use for premium-only features
 */
const requireActiveSubscription = async (req, res, next) => {
  try {
    const { user } = req;
    if (!user) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Authentication required');
    }

    const subscription = await getSubscription(user.organizationId);

    if (!isSubscriptionActive(subscription)) {
      throw new ApiError(httpStatus.PAYMENT_REQUIRED, 'Active subscription required', {
        requiresUpgrade: true,
        upgradeUrl: '/pricing',
      });
    }

    req.subscription = subscription;
    req.subscriptionLimits = getPlanLimits(subscription);

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware: Check photo upload limit
 */
const checkPhotoLimit = async (req, res, next) => {
  try {
    const { user } = req;
    if (!user) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Authentication required');
    }

    const subscription = await getSubscription(user.organizationId);
    const currentCount = req.body.currentPhotoCount || 0;
    const newCount = req.files ? req.files.length : 1;

    const result = canUploadPhotos(user, subscription, currentCount, newCount);

    if (!result.allowed) {
      throw new ApiError(httpStatus.PAYMENT_REQUIRED, result.reason, {
        limit: result.limit,
        requiresUpgrade: true,
      });
    }

    req.photoLimit = result.limit;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware: Check template creation limit
 */
const checkTemplateLimit = async (req, res, next) => {
  try {
    const { user } = req;
    if (!user) {
      throw new ApiError(httpStatus.UNAUTHORIZED, 'Authentication required');
    }

    const subscription = await getSubscription(user.organizationId);
    const currentCount = req.body.currentTemplateCount || 0;

    const result = canCreateTemplate(user, subscription, currentCount);

    if (!result.allowed) {
      throw new ApiError(httpStatus.PAYMENT_REQUIRED, result.reason, {
        limit: result.limit,
        requiresUpgrade: true,
      });
    }

    req.templateLimit = result.limit;
    next();
  } catch (error) {
    next(error);
  }
};

/**
 * Middleware: Attach subscription info without blocking
 * Use for endpoints that need subscription info but don't require it
 */
const attachSubscriptionInfo = async (req, res, next) => {
  try {
    const { user } = req;
    if (user) {
      const subscription = await getSubscription(user.organizationId);
      req.subscription = subscription;
      req.subscriptionLimits = getPlanLimits(subscription);
      req.hasActiveSubscription = isSubscriptionActive(subscription);
      req.hasUsedFreeTrial = user.trialStatus?.freeReportUsed || false;
    }
    next();
  } catch (error) {
    // Don't block, just log
    logger.warn({ error: error.message }, 'Failed to attach subscription info');
    next();
  }
};

/**
 * Check if PDF should have watermark
 * @param {Object} subscription - Subscription object
 * @returns {boolean}
 */
const shouldApplyWatermark = (subscription) => {
  const limits = getPlanLimits(subscription);
  return limits.pdfWatermark === true;
};

module.exports = {
  // Middlewares
  requireSubscriptionOrTrial,
  requireActiveSubscription,
  checkPhotoLimit,
  checkTemplateLimit,
  attachSubscriptionInfo,
  // Helper functions
  getSubscription,
  isSubscriptionActive,
  getPlanLimits,
  getCurrentUsage,
  canGenerateReport,
  canUploadPhotos,
  canCreateTemplate,
  shouldApplyWatermark,
  // Constants
  SUBSCRIPTION_STATUS,
  FEATURE_ACCESS,
  PLAN_LIMITS,
};
