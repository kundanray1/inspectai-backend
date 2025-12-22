/**
 * Usage Metering Service
 * 
 * Tracks and enforces usage limits for the freemium model.
 * Handles trial tracking and subscription usage metering.
 * 
 * @module services/usageMetering
 */

const httpStatus = require('http-status');
const mongoose = require('mongoose');
const { User, Subscription } = require('../models');
const ApiError = require('../utils/ApiError');
const logger = require('../config/logger');

/**
 * Mark user's free trial as used
 * @param {string} userId - User ID
 * @param {string} reportId - Report ID that used the trial
 * @returns {Promise<Object>}
 */
const markTrialUsed = async (userId, reportId) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }

  if (user.trialStatus?.freeReportUsed) {
    logger.warn({ userId }, 'Attempted to mark trial as used, but already used');
    return user;
  }

  user.trialStatus = {
    freeReportUsed: true,
    freeReportGeneratedAt: new Date(),
    freeReportId: new mongoose.Types.ObjectId(reportId),
  };

  await user.save();
  logger.info({ userId, reportId }, 'Free trial marked as used');

  return user;
};

/**
 * Check if user has used their free trial
 * @param {string} userId - User ID
 * @returns {Promise<boolean>}
 */
const hasUsedFreeTrial = async (userId) => {
  const user = await User.findById(userId).select('trialStatus').lean();
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }
  return user.trialStatus?.freeReportUsed === true;
};

/**
 * Increment subscription usage
 * @param {string} organizationId - Organization ID
 * @param {Object} usage - Usage to add
 * @param {number} [usage.reports=0] - Reports generated
 * @param {number} [usage.pdfExports=0] - PDFs exported
 * @returns {Promise<Object>}
 */
const incrementUsage = async (organizationId, { reports = 0, pdfExports = 0 }) => {
  const subscription = await Subscription.findOne({ organizationId });
  
  if (!subscription) {
    logger.debug({ organizationId }, 'No subscription found, skipping usage increment');
    return null;
  }

  // Get or create current period
  const now = new Date();
  let currentPeriod = null;

  if (subscription.usage && subscription.usage.length > 0) {
    const lastPeriod = subscription.usage[subscription.usage.length - 1];
    const periodEnd = new Date(lastPeriod.periodEnd);
    
    if (now < periodEnd) {
      currentPeriod = lastPeriod;
    }
  }

  if (!currentPeriod) {
    // Create new period (monthly)
    const periodStart = now;
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    currentPeriod = {
      periodStart,
      periodEnd,
      totalReports: 0,
      totalPdfExports: 0,
    };
    subscription.usage.push(currentPeriod);
  }

  // Increment usage
  currentPeriod.totalReports += reports;
  currentPeriod.totalPdfExports += pdfExports;

  await subscription.save();

  logger.debug(
    { organizationId, reports, pdfExports, totalReports: currentPeriod.totalReports },
    'Usage incremented'
  );

  return currentPeriod;
};

/**
 * Get current usage for an organization
 * @param {string} organizationId - Organization ID
 * @returns {Promise<Object>}
 */
const getCurrentUsage = async (organizationId) => {
  const subscription = await Subscription.findOne({ organizationId }).lean();
  
  if (!subscription) {
    return {
      hasSubscription: false,
      usage: null,
      limits: null,
    };
  }

  const limits = getSubscriptionLimits(subscription.plan);
  let currentUsage = { totalReports: 0, totalPdfExports: 0 };

  if (subscription.usage && subscription.usage.length > 0) {
    const lastPeriod = subscription.usage[subscription.usage.length - 1];
    const now = new Date();
    
    if (new Date(lastPeriod.periodEnd) > now) {
      currentUsage = lastPeriod;
    }
  }

  return {
    hasSubscription: true,
    status: subscription.status,
    plan: subscription.plan,
    usage: {
      reportsUsed: currentUsage.totalReports,
      reportsLimit: limits.reportsPerMonth,
      reportsRemaining: Math.max(0, limits.reportsPerMonth - currentUsage.totalReports),
      pdfExportsUsed: currentUsage.totalPdfExports,
      periodStart: currentUsage.periodStart,
      periodEnd: currentUsage.periodEnd,
    },
    limits,
  };
};

/**
 * Get subscription limits by plan
 * @param {string} plan - Plan name
 * @returns {Object}
 */
const getSubscriptionLimits = (plan) => {
  const limits = {
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
      templates: -1,
      pdfWatermark: false,
      apiAccess: true,
    },
  };

  return limits[plan] || limits.free;
};

/**
 * Check if usage is within limits
 * @param {string} organizationId - Organization ID
 * @param {string} featureType - Feature type to check
 * @returns {Promise<{ allowed: boolean, reason?: string, usage?: Object }>}
 */
const checkUsageLimit = async (organizationId, featureType) => {
  const usageInfo = await getCurrentUsage(organizationId);

  if (!usageInfo.hasSubscription) {
    return {
      allowed: false,
      reason: 'No active subscription',
      requiresUpgrade: true,
    };
  }

  switch (featureType) {
    case 'report':
      if (usageInfo.usage.reportsRemaining <= 0) {
        return {
          allowed: false,
          reason: `Monthly report limit reached (${usageInfo.limits.reportsPerMonth} reports)`,
          usage: usageInfo.usage,
          requiresUpgrade: true,
        };
      }
      break;

    case 'api':
      if (!usageInfo.limits.apiAccess) {
        return {
          allowed: false,
          reason: 'API access requires Pro plan',
          requiresUpgrade: true,
        };
      }
      break;

    default:
      break;
  }

  return { allowed: true, usage: usageInfo.usage };
};

/**
 * Get user's trial and subscription status
 * @param {string} userId - User ID
 * @param {string} organizationId - Organization ID
 * @returns {Promise<Object>}
 */
const getUserStatus = async (userId, organizationId) => {
  const [user, subscription] = await Promise.all([
    User.findById(userId).select('trialStatus usageStats').lean(),
    Subscription.findOne({ organizationId }).lean(),
  ]);

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, 'User not found');
  }

  const hasUsedTrial = user.trialStatus?.freeReportUsed === true;
  const hasActiveSubscription = subscription && ['active', 'trialing'].includes(subscription.status);

  let currentUsage = { totalReports: 0, totalPdfExports: 0 };
  if (subscription?.usage?.length > 0) {
    const lastPeriod = subscription.usage[subscription.usage.length - 1];
    if (new Date(lastPeriod.periodEnd) > new Date()) {
      currentUsage = lastPeriod;
    }
  }

  const limits = subscription ? getSubscriptionLimits(subscription.plan) : getSubscriptionLimits('free');

  return {
    userId,
    organizationId,
    trial: {
      used: hasUsedTrial,
      usedAt: user.trialStatus?.freeReportGeneratedAt,
      reportId: user.trialStatus?.freeReportId,
    },
    subscription: subscription
      ? {
          plan: subscription.plan,
          status: subscription.status,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          trialEndsAt: subscription.trialEndsAt,
        }
      : null,
    hasActiveSubscription,
    usage: {
      reports: currentUsage.totalReports,
      reportsLimit: limits.reportsPerMonth,
      reportsRemaining: hasActiveSubscription 
        ? Math.max(0, limits.reportsPerMonth - currentUsage.totalReports)
        : (hasUsedTrial ? 0 : 1),
    },
    limits,
    canGenerateReport: hasActiveSubscription || !hasUsedTrial,
  };
};

/**
 * Record a report generation event
 * @param {string} userId - User ID
 * @param {string} organizationId - Organization ID  
 * @param {string} reportId - Report ID
 * @param {boolean} isTrialReport - Whether this is a trial report
 * @returns {Promise<Object>}
 */
const recordReportGeneration = async (userId, organizationId, reportId, isTrialReport = false) => {
  // Update user stats
  await User.findByIdAndUpdate(userId, {
    $inc: { 'usageStats.totalReportsGenerated': 1 },
    $set: { 'usageStats.lastReportGeneratedAt': new Date() },
  });

  // If trial report, mark trial as used
  if (isTrialReport) {
    await markTrialUsed(userId, reportId);
  }

  // Increment subscription usage
  await incrementUsage(organizationId, { reports: 1 });

  logger.info({ userId, organizationId, reportId, isTrialReport }, 'Report generation recorded');

  return { success: true };
};

/**
 * Record a PDF export event
 * @param {string} organizationId - Organization ID
 * @returns {Promise<Object>}
 */
const recordPdfExport = async (organizationId) => {
  await incrementUsage(organizationId, { pdfExports: 1 });
  return { success: true };
};

/**
 * Record photo analysis
 * @param {string} userId - User ID
 * @param {number} photoCount - Number of photos analyzed
 * @returns {Promise<void>}
 */
const recordPhotoAnalysis = async (userId, photoCount) => {
  await User.findByIdAndUpdate(userId, {
    $inc: { 'usageStats.totalPhotosAnalyzed': photoCount },
  });
};

/**
 * Record inspection creation
 * @param {string} userId - User ID
 * @returns {Promise<void>}
 */
const recordInspectionCreation = async (userId) => {
  await User.findByIdAndUpdate(userId, {
    $inc: { 'usageStats.totalInspectionsCreated': 1 },
  });
};

module.exports = {
  markTrialUsed,
  hasUsedFreeTrial,
  incrementUsage,
  getCurrentUsage,
  getSubscriptionLimits,
  checkUsageLimit,
  getUserStatus,
  recordReportGeneration,
  recordPdfExport,
  recordPhotoAnalysis,
  recordInspectionCreation,
};

