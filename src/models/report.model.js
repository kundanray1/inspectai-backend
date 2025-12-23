const mongoose = require('mongoose');

const reportVersionSchema = new mongoose.Schema(
  {
    version: { type: Number, required: true },
    title: { type: String, required: true },
    summary: { type: String, required: true },
    introduction: { type: String },
    conclusion: { type: String },
    generatedAt: { type: Date },
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    pdfUrl: { type: String },
    watermark: { type: Boolean, default: true },
  },
  { _id: false }
);

const reportSchema = new mongoose.Schema(
  {
    inspectionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Inspection', required: true, unique: true },
    organizationId: { type: String, required: true },
    currentVersion: { type: Number, default: 1 },
    versions: { type: [reportVersionSchema], default: [] },
    distribution: {
      shareLinks: { type: [String], default: [] },
      sharedWithEmails: { type: [String], default: [] },
    },
  },
  { timestamps: true }
);

const Report = mongoose.model('Report', reportSchema);

module.exports = Report;
