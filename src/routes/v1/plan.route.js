const express = require('express');
const { planController } = require('../../controllers');

const router = express.Router();

router.get('/public', planController.listPublicPlans);

module.exports = router;

