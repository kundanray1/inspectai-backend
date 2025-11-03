module.exports.Token = require('./token.model');
module.exports.User = require('./user.model');
module.exports.Property = require('./property.model');

const inspectionExports = require('./inspection.model');

module.exports.Inspection = inspectionExports.Inspection;
module.exports.InspectionSchemas = inspectionExports;

module.exports.Report = require('./report.model');
module.exports.Subscription = require('./subscription.model');
module.exports.Setting = require('./setting.model');
module.exports.NotificationPreference = require('./notificationPreference.model');
module.exports.Plan = require('./plan.model');
