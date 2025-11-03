const express = require('express');
const auth = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const { adminController } = require('../../controllers');
const { adminValidation } = require('../../validations');

const router = express.Router();
router.get('/dashboard', auth('viewAdminDashboard'), adminController.getDashboard);
router.get('/users', auth('viewAdminDashboard'), validate(adminValidation.listAdminUsers), adminController.listUsers);
router.get('/settings', auth('viewSettings'), adminController.getSettings);
router.put('/settings/:key', auth('manageSettings'), validate(adminValidation.updateSetting), adminController.updateSetting);
router.get('/plans', auth('viewAdminDashboard'), adminController.listPlans);
router.post('/plans', auth('manageSettings'), validate(adminValidation.createPlan), adminController.createPlan);
router.post(
  '/plans/:planId/assign',
  auth('manageSettings'),
  validate(adminValidation.assignPlan),
  adminController.assignPlan
);
module.exports = router;
