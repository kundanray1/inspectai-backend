const mongoose = require('mongoose');

const reportPresetSchema = new mongoose.Schema(
  {
    organizationId: { type: String, required: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    name: { type: String, required: true },
    description: { type: String },
    schema: { type: mongoose.Schema.Types.Mixed, required: true },
    templateHtml: { type: String },
    templateCss: { type: String },
    sampleReportPath: { type: String },
    tags: { type: mongoose.Schema.Types.Mixed, default: [] },
    isDefault: { type: Boolean, default: false },
    versions: { type: mongoose.Schema.Types.Mixed, default: [] },
  },
  {
    timestamps: true,
    minimize: false,
    strict: false,
  }
);

reportPresetSchema.index({ organizationId: 1, name: 1 }, { unique: true });

const ReportPreset = mongoose.model('ReportPreset', reportPresetSchema);

module.exports = ReportPreset;
