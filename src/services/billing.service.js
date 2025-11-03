const Stripe = require('stripe');
const httpStatus = require('http-status');
const config = require('../config/config');
const ApiError = require('../utils/ApiError');
const Subscription = require('../models/subscription.model');
const planService = require('./plan.service');
const logger = require('../config/logger');

const stripeConfig = config.stripe || {};
const stripeSecret = stripeConfig.secretKey;
const stripeClient = stripeSecret ? new Stripe(stripeSecret, { apiVersion: '2023-10-16' }) : null;

const ensureStripe = () => {
  if (!stripeClient) {
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Stripe configuration missing. Contact support.');
  }
  return stripeClient;
};

const mapStripeStatus = (status) => {
  switch (status) {
    case 'active':
    case 'trialing':
    case 'past_due':
      return status;
    case 'incomplete':
    case 'incomplete_expired':
      return status;
    case 'canceled':
    case 'unpaid':
    default:
      return 'canceled';
  }
};

const ensureStripeCustomer = async ({ organizationId, email, name, fallbackId }) => {
  const fallbackCustomerId = fallbackId || `demo_${organizationId}`;

  if (!stripeClient) {
    await Subscription.findOneAndUpdate(
      { organizationId },
      {
        $set: { stripeCustomerId: fallbackCustomerId },
        $setOnInsert: {
          organizationId,
          plan: 'trial',
          status: 'trialing',
          reportLimit: 10,
          seats: 1,
          usage: [],
        },
      },
      { upsert: true }
    );
    return fallbackCustomerId;
  }

  const existing = await Subscription.findOne({ organizationId });
  if (existing && existing.stripeCustomerId) {
    try {
      await stripeClient.customers.retrieve(existing.stripeCustomerId);
      return existing.stripeCustomerId;
    } catch (error) {
      const statusCode = error && error.statusCode;
      const errorCode = error && error.code;
      if (statusCode !== 404 && errorCode !== 'resource_missing') {
        throw error;
      }
      logger.warn({ organizationId }, 'Existing Stripe customer missing - creating new');
    }
  }

  const customer = await stripeClient.customers.create({
    email,
    name,
    metadata: { organizationId },
  });

  await Subscription.findOneAndUpdate(
    { organizationId },
    {
      $set: { stripeCustomerId: customer.id },
      $setOnInsert: {
        organizationId,
        plan: 'trial',
        status: 'trialing',
        reportLimit: 10,
        seats: 1,
        usage: [],
      },
    },
    { upsert: true }
  );

  return customer.id;
};

const listPlans = (organizationId) => planService.getPlansForOrganization(organizationId);

const createCheckoutSession = async ({ organizationId, customerEmail, customerName, priceId, cancelUrl }) => {
  const stripe = ensureStripe();
  const plan = await planService.getPlanByPriceId(priceId);

  if (!plan) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Unknown plan selected');
  }
  if (!plan.stripePriceId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Selected plan is not available for checkout.');
  }

  const stripeCustomerId = await ensureStripeCustomer({
    organizationId,
    email: customerEmail,
    name: customerName,
  });

  const successUrl = stripeConfig.returnUrl || cancelUrl;
  const cancelUrlFinal = cancelUrl || successUrl;

  if (!successUrl) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Stripe return URL is not configured.');
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: stripeCustomerId,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrlFinal,
    metadata: {
      organizationId,
      planId: plan.slug,
      priceId: plan.stripePriceId,
    },
  });

  return session.url;
};

const createBillingPortalSession = async ({ organizationId, returnUrl }) => {
  const stripe = ensureStripe();
  const subscription = await Subscription.findOne({ organizationId });

  if (!subscription || !subscription.stripeCustomerId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'An active Stripe customer is required to open the billing portal.');
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: subscription.stripeCustomerId,
    return_url: returnUrl || stripeConfig.returnUrl,
  });

  return session.url;
};

const cancelStripeSubscription = async ({ organizationId }) => {
  const stripe = ensureStripe();
  const subscription = await Subscription.findOne({ organizationId });

  if (!subscription || !subscription.stripeSubscriptionId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No active subscription found to cancel.');
  }

  await stripe.subscriptions.update(subscription.stripeSubscriptionId, { cancel_at_period_end: true });
  subscription.status = 'canceled';
  subscription.reportLimit = 0;
  subscription.cancelAtPeriodEnd = true;
  await subscription.save();

  return subscription.toObject();
};

const resumeStripeSubscription = async ({ organizationId }) => {
  const stripe = ensureStripe();
  const subscription = await Subscription.findOne({ organizationId });

  if (!subscription || !subscription.stripeSubscriptionId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'No Stripe subscription found to resume.');
  }

  await stripe.subscriptions.update(subscription.stripeSubscriptionId, { cancel_at_period_end: false });
  subscription.status = 'active';
  subscription.cancelAtPeriodEnd = false;
  await subscription.save();

  return subscription.toObject();
};

const syncSubscriptionFromStripe = async ({ organizationId, plan, stripeSubscription, customerId }) => {
  const extraFields = {
    stripeCustomerId: customerId,
    stripeSubscriptionId: stripeSubscription.id,
    status: mapStripeStatus(stripeSubscription.status || 'active'),
    trialEndsAt: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : null,
    cancelAtPeriodEnd: Boolean(stripeSubscription.cancel_at_period_end),
  };

  await planService.assignPlanToOrganization({ planId: plan.id, planSlug: plan.slug, organizationId, extraFields });
};

const handleCheckoutCompleted = async (session) => {
  ensureStripe();
  const metadata = session.metadata || {};
  const { organizationId } = metadata;
  if (!organizationId) {
    logger.warn('checkout.session.completed missing organization metadata');
    return;
  }

  const { subscription: subscriptionId, customer: customerId } = session;

  if (!subscriptionId) {
    logger.warn('checkout.session.completed missing subscription id');
    return;
  }

  let stripeSubscription;
  try {
    stripeSubscription = await stripeClient.subscriptions.retrieve(subscriptionId, { expand: ['items.data.price'] });
  } catch (error) {
    logger.error({ err: error }, 'Failed to retrieve Stripe subscription during webhook sync');
    throw error;
  }

  const subscriptionItems = (stripeSubscription.items && stripeSubscription.items.data) || [];
  const [firstItem = {}] = subscriptionItems;
  const priceFromSubscription = firstItem.price && firstItem.price.id ? firstItem.price.id : undefined;
  const priceId = metadata.priceId || priceFromSubscription;
  const planSlug = metadata.planId;

  const plan =
    (priceId ? await planService.getPlanByPriceId(priceId) : null) ||
    (planSlug ? await planService.getPlanBySlug(planSlug) : null);

  if (!plan) {
    logger.error({ priceId, planSlug }, 'Unable to resolve InspectAI plan for checkout session');
    throw new ApiError(httpStatus.BAD_REQUEST, 'Unable to resolve plan for subscription');
  }

  await syncSubscriptionFromStripe({
    organizationId,
    plan,
    stripeSubscription,
    customerId,
  });
};

const handleSubscriptionUpdated = async (stripeSubscription) => {
  ensureStripe();
  const { id: subscriptionId, customer: customerId } = stripeSubscription;

  const existing =
    (await Subscription.findOne({ stripeSubscriptionId: subscriptionId })) ||
    (customerId ? await Subscription.findOne({ stripeCustomerId: customerId }) : null);

  if (!existing) {
    logger.warn({ subscriptionId, customerId }, 'Received subscription update for unknown organization');
    return;
  }

  const items = (stripeSubscription.items && stripeSubscription.items.data) || [];
  const [firstItem = {}] = items;
  const priceId = firstItem.price && firstItem.price.id ? firstItem.price.id : undefined;
  const plan = priceId ? await planService.getPlanByPriceId(priceId) : null;

  const extraFields = {
    stripeCustomerId: customerId || existing.stripeCustomerId,
    stripeSubscriptionId: subscriptionId,
    status: mapStripeStatus(stripeSubscription.status || existing.status),
    trialEndsAt: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : existing.trialEndsAt,
    cancelAtPeriodEnd: Boolean(stripeSubscription.cancel_at_period_end),
  };

  if (plan) {
    await planService.assignPlanToOrganization({
      planId: plan.id,
      planSlug: plan.slug,
      organizationId: existing.organizationId,
      extraFields,
    });
  } else {
    await Subscription.findOneAndUpdate({ organizationId: existing.organizationId }, { $set: extraFields }, { new: true });
  }
};

const handleSubscriptionDeleted = async (stripeSubscription) => {
  const { id: subscriptionId, customer: customerId } = stripeSubscription;
  const existing =
    (await Subscription.findOne({ stripeSubscriptionId: subscriptionId })) ||
    (customerId ? await Subscription.findOne({ stripeCustomerId: customerId }) : null);

  if (!existing) {
    return;
  }

  await Subscription.findOneAndUpdate(
    { organizationId: existing.organizationId },
    {
      $set: {
        status: 'canceled',
        cancelAtPeriodEnd: true,
        stripeSubscriptionId: subscriptionId,
      },
    }
  );
};

module.exports = {
  listPlans,
  ensureStripeCustomer,
  createCheckoutSession,
  createBillingPortalSession,
  cancelStripeSubscription,
  resumeStripeSubscription,
  handleCheckoutCompleted,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
};
