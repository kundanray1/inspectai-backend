module.exports.authService = require('./auth.service');
module.exports.emailService = require('./email.service');
module.exports.tokenService = require('./token.service');
module.exports.userService = require('./user.service');
module.exports.adminService = require('./admin.service');
module.exports.billingService = require('./billing.service');
module.exports.notificationService = require('./notification.service');
module.exports.planService = require('./plan.service');
module.exports.jobService = require('./job.service');
module.exports.reportPresetService = require('./reportPreset.service');
module.exports.inspectionQueue = require('../queues/inspection.queue');

// AI Services
module.exports.geminiService = require('./ai/gemini.service');
