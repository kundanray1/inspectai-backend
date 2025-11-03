const mongoose = require('mongoose');

const usageMetricSchema = new mongoose.Schema(
  {
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    totalReports: { type: Number, default: 0 },
    totalPdfExports: { type: Number, default: 0 },
  },
  { _id: false }
);

const subscriptionSchema = new mongoose.Schema(
  {
    organizationId: { type: String, required: true, unique: true },
    stripeCustomerId: { type: String, required: true },
    stripeSubscriptionId: { type: String },
    plan: { type: String, enum: ['starter', 'pro', 'enterprise'], default: 'starter' },
    status: { type: String, enum: ['trialing', 'active', 'past_due', 'canceled'], default: 'trialing' },
    trialEndsAt: { type: Date },
    seats: { type: Number, default: 1 },
    reportLimit: { type: Number, default: 10 },
    usage: { type: [usageMetricSchema], default: [] },
  },
  { timestamps: true }
);

const Subscription = mongoose.model('Subscription', subscriptionSchema);

module.exports = Subscription;
