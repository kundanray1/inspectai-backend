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

router.post(
  '/:id/photos',
  auth(),
  upload.array('photos'),
  validate(inspectionValidation.uploadPhotos),
  photoController.uploadPhotos
);

module.exports = router;
