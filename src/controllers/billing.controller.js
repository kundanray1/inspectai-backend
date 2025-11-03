const Stripe = require('stripe');
const httpStatus = require('http-status');
const config = require('../config/config');
const logger = require('../config/logger');
const { billingService } = require('../services');

const stripeSecret = config.stripe ? config.stripe.secretKey : undefined;
const webhookSecret = config.stripe ? config.stripe.webhookSecret : undefined;
const stripe = stripeSecret ? new Stripe(stripeSecret, { apiVersion: '2023-10-16' }) : null;

const handleWebhook = async (req, res, next) => {
  if (!stripe || !webhookSecret) {
    res.status(httpStatus.SERVICE_UNAVAILABLE).send({ message: 'Stripe webhook configuration missing' });
    return;
  }

  const signature = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, signature, webhookSecret);
  } catch (error) {
    logger.error({ err: error }, 'Stripe webhook signature verification failed');
    res.status(httpStatus.BAD_REQUEST).send({ message: 'Webhook signature verification failed' });
    return;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await billingService.handleCheckoutCompleted(event.data.object);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await billingService.handleSubscriptionUpdated(event.data.object);
        break;
      case 'customer.subscription.deleted':
        await billingService.handleSubscriptionDeleted(event.data.object);
        break;
      default:
        logger.debug({ type: event.type }, 'Unhandled Stripe webhook event type');
    }
  } catch (error) {
    logger.error({ err: error, type: event.type }, 'Error handling Stripe webhook event');
    return next(error);
  }

  res.json({ received: true });
};

module.exports = {
  handleWebhook,
};
