const mongoose = require('mongoose');

const schemaVersion = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    schema: { type: mongoose.Schema.Types.Mixed, required: true },
    sourceFilePath: { type: String },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const reportPresetSchema = new mongoose.Schema(
  {
    organizationId: { type: String, required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    description: { type: String },
    schema: { type: mongoose.Schema.Types.Mixed, required: true },
    sampleReportPath: { type: String },
    tags: { type: [String], default: [] },
    isDefault: { type: Boolean, default: false },
    versions: { type: [schemaVersion], default: [] },
  },
  { timestamps: true }
);

reportPresetSchema.index({ organizationId: 1, name: 1 }, { unique: true });

const ReportPreset = mongoose.model('ReportPreset', reportPresetSchema);

module.exports = ReportPreset;
