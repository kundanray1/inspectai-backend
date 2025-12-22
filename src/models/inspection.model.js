const mongoose = require('mongoose');

const photoIssueSchema = new mongoose.Schema(
  {
    label: { type: String, required: true },
    severity: { type: String, enum: ['low', 'medium', 'high'], required: true },
    confidence: { type: Number, min: 0, max: 1, required: true },
  },
  { _id: false }
);

const photoSchema = new mongoose.Schema(
  {
    storagePath: { type: String, required: true },
    thumbnailUrl: { type: String },
    originalFilename: { type: String, required: true },
    fileSize: { type: Number, required: true },
    mimeType: { type: String, required: true },
    capturedAt: { type: Date },
    roomClassification: { type: String },
    classificationConfidence: { type: Number, min: 0, max: 1 },
    pendingClassification: { type: Boolean, default: false },
    condition: { type: String },
    positives: { type: [String], default: [] },
    qualityWarnings: { type: [String], default: [] },
    issues: { type: [photoIssueSchema], default: [] },
    aiSummary: { type: String },
  },
  { timestamps: true }
);

const roomSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    displayOrder: { type: Number, default: 0 },
    conditionRating: { type: String, enum: ['excellent', 'good', 'fair', 'needs_maintenance'] },
    notes: { type: String },
    actions: { type: [String], default: [] },
    aiSummary: { type: String },
    photos: { type: [photoSchema], default: [] },
  },
  { timestamps: true }
);

const inspectionSchema = new mongoose.Schema(
  {
    propertyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Property', required: true },
    organizationId: { type: String, required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    status: { type: String, enum: ['draft', 'in_progress', 'completed'], default: 'draft' },
    scheduledFor: { type: Date },
    startedAt: { type: Date },
    completedAt: { type: Date },
    rooms: { type: [roomSchema], default: [] },
    summary: { type: String },
    aiSummary: { type: String },
    shareLinkToken: { type: String, unique: true, sparse: true },
    reportPresetId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReportPreset' },
  },
  { timestamps: true }
);

inspectionSchema.index({ propertyId: 1, status: 1 });

const Inspection = mongoose.model('Inspection', inspectionSchema);

module.exports = { Inspection, roomSchema, photoSchema, photoIssueSchema };
