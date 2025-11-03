const httpStatus = require('http-status');
const catchAsync = require('../utils/catchAsync');
const { adminService } = require('../services');

const getDashboard = catchAsync(async (req, res) => {
  const summary = await adminService.getDashboardSummary();
  res.send({ data: summary });
});

const listUsers = catchAsync(async (req, res) => {
  const payload = await adminService.listAdminUsers({
    email: req.query.email,
    status: req.query.status,
    isAdmin: req.query.isAdmin,
    page: req.query.page,
    limit: req.query.limit,
  });

  res.send(payload);
});

const getSettings = catchAsync(async (req, res) => {
  const settings = await adminService.getAdminSettings();
  res.send({ data: settings });
});

const updateSetting = catchAsync(async (req, res) => {
  const { key } = req.params;
  if (!key) {
    res.status(httpStatus.BAD_REQUEST).send({ message: 'Setting key is required' });
    return;
  }

  const userId = req.user ? req.user.id : undefined;
  const updated = await adminService.updateAdminSetting(key, req.body, userId);
  res.send({ data: updated });
});

module.exports = {
  getDashboard,
  listUsers,
  getSettings,
  updateSetting,
};
