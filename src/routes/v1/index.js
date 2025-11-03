const express = require('express');
const authRoute = require('./auth.route');
const userRoute = require('./user.route');
const propertyRoute = require('./property.route');
const inspectionRoute = require('./inspection.route');
const reportRoute = require('./report.route');
const subscriptionRoute = require('./subscription.route');
const adminRoute = require('./admin.route');
const accountRoute = require('./account.route');
const planRoute = require('./plan.route');
const docsRoute = require('./docs.route');
const config = require('../../config/config');

const router = express.Router();

const defaultRoutes = [
  {
    path: '/auth',
    route: authRoute,
  },
  {
    path: '/users',
    route: userRoute,
  },
  {
    path: '/properties',
    route: propertyRoute,
  },
  {
    path: '/inspections',
    route: inspectionRoute,
  },
  {
    path: '/reports',
    route: reportRoute,
  },
  {
    path: '/subscriptions',
    route: subscriptionRoute,
  },
  {
    path: '/admin',
    route: adminRoute,
  },
  {
    path: '/account',
    route: accountRoute,
  },
  {
    path: '/plans',
    route: planRoute,
  },
];

const devRoutes = [
  // routes available only in development mode
  {
    path: '/docs',
    route: docsRoute,
  },
];

defaultRoutes.forEach((route) => {
  router.use(route.path, route.route);
});

/* istanbul ignore next */
if (config.env === 'development') {
  devRoutes.forEach((route) => {
    router.use(route.path, route.route);
  });
}

module.exports = router;
