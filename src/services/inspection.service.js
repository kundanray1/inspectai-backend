const mongoose = require('mongoose');
const { Inspection } = require('../models/inspection.model');
const Report = require('../models/report.model');

const createInspection = async ({ propertyId, organizationId, createdBy, scheduledFor, rooms, reportPresetId }) => {
  const inspection = await Inspection.create({
    propertyId: new mongoose.Types.ObjectId(propertyId),
    organizationId,
    createdBy: new mongoose.Types.ObjectId(createdBy),
    scheduledFor: scheduledFor ? new Date(scheduledFor) : undefined,
    reportPresetId: reportPresetId ? new mongoose.Types.ObjectId(reportPresetId) : undefined,
    rooms: Array.isArray(rooms)
      ? rooms.map((room, index) => ({
          name: room.name,
          displayOrder: typeof room.displayOrder === 'number' ? room.displayOrder : index,
        }))
      : [],
  });

  await Report.create({
    inspectionId: inspection._id,
    organizationId,
    currentVersion: 0,
    versions: [],
  });

  return inspection;
};

const addRoomToInspection = async (inspectionId, organizationId, room) => {
  return Inspection.findOneAndUpdate(
    { _id: inspectionId, organizationId },
    {
      $push: {
        rooms: {
          name: room.name,
          displayOrder: typeof room.displayOrder === 'number' ? room.displayOrder : 0,
          photos: [],
        },
      },
    },
    { new: true }
  );
};

const updateRoomInInspection = async (inspectionId, roomId, organizationId, updates) => {
  const fields = {};

  if (updates.name) fields['rooms.$.name'] = updates.name;
  if (updates.displayOrder !== undefined) fields['rooms.$.displayOrder'] = updates.displayOrder;
  if (updates.conditionRating) fields['rooms.$.conditionRating'] = updates.conditionRating;
  if (updates.notes !== undefined) fields['rooms.$.notes'] = updates.notes;
  if (updates.actions) fields['rooms.$.actions'] = updates.actions;
  if (updates.aiSummary) fields['rooms.$.aiSummary'] = updates.aiSummary;

  return Inspection.findOneAndUpdate(
    { _id: inspectionId, organizationId, 'rooms._id': roomId },
    { $set: fields },
    { new: true }
  );
};

module.exports = {
  createInspection,
  addRoomToInspection,
  updateRoomInInspection,
};
