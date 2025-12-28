const httpStatus = require('http-status');
const Plan = require('../models/plan.model');
const Subscription = require('../models/subscription.model');
const ApiError = require('../utils/ApiError');
const config = require('../config/config');

const formatPlan = (planDoc) => {
  if (!planDoc) return null;
  const plan = planDoc.toObject ? planDoc.toObject() : planDoc;
  return {
    id: plan._id.toString(),
    slug: plan.slug,
    name: plan.name,
    description: plan.description,
    priceMonthly: plan.priceMonthly,
    currency: plan.currency,
    reportLimit: plan.reportLimit,
    features: plan.features || [],
    stripePriceId: plan.stripePriceId,
    trialDays: plan.trialDays,
    isPublic: plan.isPublic,
    isCustom: plan.isCustom,
    organizationId: plan.organizationId,
    active: plan.active,
    createdAt: plan.createdAt,
    updatedAt: plan.updatedAt,
  };
};

const getPublicPlans = async () => {
  const plans = await Plan.find({ isPublic: true, active: true }).sort({ priceMonthly: 1, createdAt: 1 });
  return plans.map(formatPlan);
};

const getPlansForOrganization = async (organizationId) => {
  const publicPlans = await getPublicPlans();
  if (!organizationId) return publicPlans;

  const customPlans = await Plan.find({ organizationId, active: true }).sort({ createdAt: 1 });
  return [...publicPlans, ...customPlans.map(formatPlan)];
};

const getPlanBySlug = async (slug) => {
  if (!slug) return null;
  const plan = await Plan.findOne({ slug, active: true });
  return plan ? formatPlan(plan) : null;
};

const getPlanByPriceId = async (priceId) => {
  if (!priceId) return null;
  const plan = await Plan.findOne({ stripePriceId: priceId, active: true });
  return plan ? formatPlan(plan) : null;
};

const ensureDefaultPlans = async () => {
  const defaults = [
    {
      slug: 'trial',
      name: 'Free Trial',
      description: 'Evaluate Sitewise with a complimentary starter plan.',
      priceMonthly: 0,
      currency: 'usd',
      reportLimit: 1,
      features: ['1 inspection included', 'AI summaries with watermark', 'Standard PDF exports'],
      stripePriceId: null,
      trialDays: 7,
      isPublic: true,
      isCustom: false,
    },
    {
      slug: 'pro',
      name: 'Pro',
      description: 'Unlock full Sitewise automation for fast-moving teams.',
      priceMonthly: 25,
      currency: 'usd',
      reportLimit: 20,
      features: ['20 inspections per month', 'Branded PDF exports', 'Priority support & AI suggestions'],
      stripePriceId: (config.stripe && config.stripe.pricePro) || null,
      trialDays: 0,
      isPublic: true,
      isCustom: false,
    },
    {
      slug: 'custom',
      name: 'Talk to us',
      description: 'Tailored plans for enterprise portfolios and agencies.',
      priceMonthly: null,
      currency: 'usd',
      reportLimit: 0,
      features: ['Dedicated success manager', 'Unlimited team members', 'Custom workflows & integrations'],
      stripePriceId: null,
      trialDays: 0,
      isPublic: true,
      isCustom: true,
    },
  ];

  await Promise.all(
    defaults.map(async (plan) => {
      const existing = await Plan.findOne({ slug: plan.slug });
      if (!existing) {
        await Plan.create(plan);
      } else if (
        !existing.active ||
        existing.name !== plan.name ||
        existing.reportLimit !== plan.reportLimit ||
        existing.trialDays !== plan.trialDays
      ) {
        await Plan.updateOne({ _id: existing._id }, { $set: plan });
      }
    })
  );
};

const createPlan = async (payload) => {
  const planPayload = { ...payload };
  if (planPayload.slug) {
    planPayload.slug = planPayload.slug.toLowerCase();
  }
  const existing = planPayload.slug ? await Plan.findOne({ slug: planPayload.slug }) : null;
  if (existing) {
    throw new ApiError(httpStatus.CONFLICT, 'A plan with this slug already exists');
  }

  const plan = await Plan.create(planPayload);
  return formatPlan(plan);
};

const listAllPlans = async () => {
  const plans = await Plan.find({}).sort({ createdAt: -1 });
  return plans.map(formatPlan);
};

const assignPlanToOrganization = async ({ planId, planSlug, organizationId, extraFields = {} }) => {
  let planDoc = null;

  if (planId) {
    planDoc = await Plan.findOne({ _id: planId, active: true });
  }

  if (!planDoc && planSlug) {
    planDoc = await Plan.findOne({ slug: planSlug, active: true });
  }

  if (!planDoc) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Plan not found');
  }

  const updatePayload = {
    plan: planDoc.slug,
    reportLimit: planDoc.reportLimit,
    ...extraFields,
  };

  Object.keys(updatePayload).forEach((key) => {
    if (updatePayload[key] === undefined) {
      delete updatePayload[key];
    }
  });

  if (!Object.prototype.hasOwnProperty.call(updatePayload, 'stripeCustomerId')) {
    updatePayload.stripeCustomerId = `demo_${organizationId}`;
  }

  const setOnInsertPayload = {
    organizationId,
  };

  const subscription = await Subscription.findOneAndUpdate(
    { organizationId },
    {
      $set: updatePayload,
      $setOnInsert: setOnInsertPayload,
    },
    { new: true, upsert: true }
  );

  return subscription ? subscription.toObject() : null;
};

module.exports = {
  ensureDefaultPlans,
  getPublicPlans,
  getPlansForOrganization,
  getPlanBySlug,
  getPlanByPriceId,
  createPlan,
  listAllPlans,
  assignPlanToOrganization,
};
