const express = require('express');
const auth = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const inspectionController = require('../../controllers/inspection.controller');
const photoController = require('../../controllers/photo.controller');
const inspectionValidation = require('../../validations/inspection.validation');
const { upload } = require('../../middlewares/upload');

const router = express.Router();

router
  .route('/')
  .get(auth(), validate(inspectionValidation.listInspections), inspectionController.listInspections)
  .post(auth(), validate(inspectionValidation.createInspection), inspectionController.createInspection);

router
  .route('/:id')
  .get(auth(), inspectionController.getInspection)
  .patch(auth(), validate(inspectionValidation.updateInspection), inspectionController.updateInspection);

router.post('/:id/complete', auth(), inspectionController.completeInspection);

router.post('/:id/rooms', auth(), validate(inspectionValidation.addRoom), inspectionController.addRoom);

router.patch('/:id/rooms/:roomId', auth(), validate(inspectionValidation.updateRoom), inspectionController.updateRoom);

router.post(
  '/:id/rooms/:roomId/analyse',
  auth(),
  validate(inspectionValidation.analyseRoom),
  inspectionController.analyseRoom
);

// Legacy multipart upload (backwards compatible)
router.post(
  '/:id/photos',
  auth(),
  upload.array('photos'),
  validate(inspectionValidation.uploadPhotos),
  photoController.uploadPhotos
);

// Presigned URL flow - Step 1: Get upload URLs
router.post(
  '/:id/photos/upload-urls',
  auth(),
  validate(inspectionValidation.getUploadUrls),
  photoController.getUploadUrls
);

// Presigned URL flow - Step 2: Register uploaded photos
router.post(
  '/:id/photos/register',
  auth(),
  validate(inspectionValidation.registerPhotos),
  photoController.registerPhotos
);

// Get all photo URLs for an inspection
router.get(
  '/:id/photos/urls',
  auth(),
  photoController.getAllPhotoUrls
);

// Get single photo URL
router.get(
  '/:id/photos/:photoId/url',
  auth(),
  photoController.getPhotoUrl
);

module.exports = router;
