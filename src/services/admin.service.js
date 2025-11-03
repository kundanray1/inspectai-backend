const mongoose = require('mongoose');
const { User, Subscription, Setting } = require('../models');

const DASHBOARD_SETTING_KEY = 'admin.dashboard';
const SETTINGS_GROUP_KEY = 'admin.settings';

const defaultDashboardSetting = {
  totals: {
    pageViews: 0,
    revenue: 22152.58,
    payingUsers: 154,
    signups: 5527,
    profit: 10,
  },
  revenueTrend: {
    range: 'last_7_days',
    points: [],
  },
  topSources: [],
  notes: 'Default dashboard metrics seeded from product requirements.',
};

const getOrCreateSetting = async (key, defaults) => {
  const existing = await Setting.findOne({ key });
  if (existing) return existing;
  return Setting.create({ key, data: defaults });
};

const getDashboardSummary = async () => {
  const dashboardSetting = await getOrCreateSetting(DASHBOARD_SETTING_KEY, defaultDashboardSetting);
  const settingData = dashboardSetting.data || defaultDashboardSetting;

  const totalUsers = await User.countDocuments({});
  const payingUsers = await Subscription.countDocuments({ status: { $in: ['active', 'trialing'] } });

  const totalsBase = settingData.totals || defaultDashboardSetting.totals;
  const totals = {
    ...totalsBase,
    computed: {
      signups: totalUsers,
      payingUsers,
    },
  };

  return {
    totals,
    revenueTrend: settingData.revenueTrend || defaultDashboardSetting.revenueTrend,
    topSources: settingData.topSources || defaultDashboardSetting.topSources,
    notes: settingData.notes,
    updatedAt: dashboardSetting.updatedAt,
  };
};

const listAdminUsers = async ({ email, status, isAdmin, page = 1, limit = 10 }) => {
  const pageNumber = Math.max(Number(page) || 1, 1);
  const pageSize = Math.min(Math.max(Number(limit) || 10, 1), 100);

  const userMatch = {};
  if (email) {
    userMatch.email = { $regex: email.trim(), $options: 'i' };
  }

  const adminRoles = ['admin', 'superadmin'];
  if (isAdmin === 'true') {
    userMatch.role = { $in: adminRoles };
  } else if (isAdmin === 'false') {
    userMatch.role = { $nin: adminRoles };
  }

  const subscriptionMatch = {};
  if (status) {
    subscriptionMatch['subscription.status'] = status;
  }

  const pipeline = [
    { $match: userMatch },
    {
      $lookup: {
        from: 'subscriptions',
        localField: 'organizationId',
        foreignField: 'organizationId',
        as: 'subscription',
      },
    },
    {
      $unwind: {
        path: '$subscription',
        preserveNullAndEmptyArrays: true,
      },
    },
  ];

  if (status) {
    pipeline.push({ $match: subscriptionMatch });
  }

  pipeline.push(
    {
      $project: {
        _id: 1,
        email: 1,
        name: 1,
        role: 1,
        lastActiveAt: 1,
        organizationId: 1,
        createdAt: 1,
        subscription: {
          status: '$subscription.status',
          plan: '$subscription.plan',
          stripeCustomerId: '$subscription.stripeCustomerId',
          stripeSubscriptionId: '$subscription.stripeSubscriptionId',
        },
      },
    },
    { $sort: { createdAt: -1 } },
    {
      $facet: {
        results: [{ $skip: (pageNumber - 1) * pageSize }, { $limit: pageSize }],
        totalCount: [{ $count: 'count' }],
      },
    }
  );

  const aggregateResult = await User.aggregate(pipeline);
  const firstBucket = aggregateResult[0] || { results: [], totalCount: [] };
  const results = firstBucket.results || [];
  const totalCount = firstBucket.totalCount && firstBucket.totalCount[0] ? firstBucket.totalCount[0].count : 0;

  const mappedResults = results.map((userDoc) => {
    const subscription = userDoc.subscription || {};
    return {
      id: userDoc._id.toString(),
      email: userDoc.email,
      name: userDoc.name,
      role: userDoc.role,
      isAdmin: adminRoles.includes(userDoc.role),
      subscriptionStatus: subscription.status || 'unsubscribed',
      stripeCustomerId: subscription.stripeCustomerId || null,
      stripeSubscriptionId: subscription.stripeSubscriptionId || null,
      plan: subscription.plan || null,
      organizationId: userDoc.organizationId,
      lastActiveAt: userDoc.lastActiveAt,
      createdAt: userDoc.createdAt,
    };
  });

  const totalPages = Math.ceil(totalCount / pageSize) || 1;

  return {
    results: mappedResults,
    page: pageNumber,
    limit: pageSize,
    totalPages,
    totalResults: totalCount,
  };
};

const getAdminSettings = async () => {
  const setting = await getOrCreateSetting(SETTINGS_GROUP_KEY, {
    branding: {
      productName: 'InspectAI',
      supportEmail: 'support@inspectai.app',
      marketingSite: 'https://inspectai.app',
    },
    billing: {
      defaultPlan: 'starter',
      trialLengthDays: 7,
    },
  });

  return setting.data;
};

const updateAdminSetting = async (key, payload, userId) => {
  const setting = await getOrCreateSetting(SETTINGS_GROUP_KEY, {});
  const nextData = {
    ...(setting.data || {}),
    [key]: payload,
  };

  setting.data = nextData;
  setting.updatedBy = userId ? new mongoose.Types.ObjectId(userId) : setting.updatedBy;
  await setting.save();

  return setting.data;
};

module.exports = {
  getDashboardSummary,
  listAdminUsers,
  getAdminSettings,
  updateAdminSetting,
};
