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
module.exports = router;
