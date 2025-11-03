const catchAsync = require('../utils/catchAsync');
const { planService } = require('../services');

const listPublicPlans = catchAsync(async (_req, res) => {
  const plans = await planService.getPublicPlans();
  res.send({ data: plans });
});

module.exports = {
  listPublicPlans,
};

