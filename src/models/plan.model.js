const mongoose = require('mongoose');

const planSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true },
    description: { type: String },
    priceMonthly: { type: Number },
    currency: { type: String, default: 'usd' },
    reportLimit: { type: Number, default: 0 },
    features: { type: [String], default: [] },
    stripePriceId: { type: String },
    trialDays: { type: Number, default: 0 },
    isPublic: { type: Boolean, default: false },
    isCustom: { type: Boolean, default: false },
    organizationId: { type: String, default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

planSchema.index({ isPublic: 1, active: 1 });
planSchema.index({ organizationId: 1, active: 1 });

const Plan = mongoose.model('Plan', planSchema);

module.exports = Plan;

