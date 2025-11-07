const mongoose = require('mongoose');

const jobEventSchema = new mongoose.Schema(
  {
    type: { type: String, required: true },
    message: { type: String },
    progress: { type: Number },
    metadata: { type: mongoose.Schema.Types.Mixed },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const jobSchema = new mongoose.Schema(
  {
    inspectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Inspection', required: true, index: true },
    roomId: { type: mongoose.Schema.Types.ObjectId, ref: 'Inspection.rooms' },
    organizationId: { type: String, required: true, index: true },
    type: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'queued', 'processing', 'completed', 'failed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    progress: { type: Number, default: 0, min: 0, max: 100 },
    processedUnits: { type: Number, default: 0 },
    totalUnits: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 },
    lastError: { type: String },
    payload: { type: mongoose.Schema.Types.Mixed },
    result: { type: mongoose.Schema.Types.Mixed },
    events: { type: [jobEventSchema], default: [] },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

jobSchema.index({ inspectionId: 1, status: 1 });
jobSchema.index({ createdAt: -1 });

const Job = mongoose.model('Job', jobSchema);

module.exports = Job;
