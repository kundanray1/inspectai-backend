const mongoose = require('mongoose');
const Report = require('../models/report.model');
const { Inspection } = require('../models/inspection.model');

const generateReport = async (inspectionId, organizationId, { generatedBy, introduction, conclusion }) => {
  const inspection = await Inspection.findOne({ _id: inspectionId, organizationId }).lean();
  if (!inspection) {
    const error = new Error('Inspection not found');
    error.statusCode = 404;
    throw error;
  }

  const rooms = Array.isArray(inspection.rooms) ? inspection.rooms : [];

  const summary =
    rooms.length === 0
      ? 'Inspection contains no rooms yet.'
      : rooms
          .map((room) => {
            const condition = room.conditionRating ? room.conditionRating : 'unrated';
            return `${room.name}: ${condition.replace('_', ' ')}`;
          })
          .join('\n');

  const hasIntroduction = introduction !== undefined && introduction !== null;
  const introText = hasIntroduction
    ? introduction
    : `This inspection covers ${rooms.length} spaces within the property. All findings are summarised by room with condition ratings.`;

  const hasConclusion = conclusion !== undefined && conclusion !== null;
  const conclusionText = hasConclusion
    ? conclusion
    : 'Review recommended actions and schedule follow-ups for outstanding issues.';

  const report = await Report.findOne({ inspectionId, organizationId });

  const baseVersion = report && typeof report.currentVersion === 'number' ? report.currentVersion : 0;
  const nextVersion = baseVersion + 1;
  const versionPayload = {
    version: nextVersion,
    title: `Inspection report v${nextVersion}`,
    summary,
    introduction: introText,
    conclusion: conclusionText,
    generatedAt: new Date(),
    generatedBy: new mongoose.Types.ObjectId(generatedBy),
    watermark: nextVersion === 1,
  };

  const updatedReport = await Report.findOneAndUpdate(
    { inspectionId, organizationId },
    {
      $set: {
        organizationId: inspection.organizationId,
        currentVersion: nextVersion,
      },
      $push: { versions: versionPayload },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  if (!updatedReport) {
    throw new Error('Failed to create or update report');
  }

  return updatedReport.toObject();
};

module.exports = {
  generateReport,
};
