const Stripe = require('stripe');
const httpStatus = require('http-status');
const config = require('../config/config');
const ApiError = require('../utils/ApiError');
const Subscription = require('../models/subscription.model');
const planService = require('./plan.service');

const stripeConfig = config.stripe || {};
const stripeSecret = stripeConfig.secretKey;
const stripeClient = stripeSecret ? new Stripe(stripeSecret, { apiVersion: '2023-10-16' }) : null;

const ensureStripe = () => {
  if (!stripeClient) {
    throw new ApiError(httpStatus.SERVICE_UNAVAILABLE, 'Stripe configuration missing. Contact support.');
  }
  return stripeClient;
};

const listPlans = (organizationId) => planService.getPlansForOrganization(organizationId);

const createCheckoutSession = async ({ organizationId, customerEmail, priceId, cancelUrl }) => {
  const stripe = ensureStripe();
  const subscription = await Subscription.findOne({ organizationId });
  const plan = await planService.getPlanByPriceId(priceId);

  if (!plan) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Unknown plan selected');
  }
  if (!plan.stripePriceId) {
    throw new ApiError(httpStatus.BAD_REQUEST, 'Selected plan is not available for checkout.');
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: subscription && subscription.stripeCustomerId ? subscription.stripeCustomerId : undefined,
    customer_email: subscription && subscription.stripeCustomerId ? undefined : customerEmail,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    success_url: stripeConfig.returnUrl || cancelUrl,
    cancel_url: cancelUrl,
    metadata: {
      organizationId,
      planId: plan.slug,
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

module.exports = {
  listPlans,
  createCheckoutSession,
  createBillingPortalSession,
  cancelStripeSubscription,
  resumeStripeSubscription,
};
