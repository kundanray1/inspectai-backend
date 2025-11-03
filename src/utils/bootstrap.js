const crypto = require('crypto');
const mongoose = require('mongoose');
const config = require('../config/config');
const logger = require('../config/logger');
const { userService } = require('../services');
const User = require('../models/user.model');

const ensureSuperAdmin = async () => {
  const { superAdmin: superAdminConfig = {} } = config;
  const { email, password: configuredPassword, name } = superAdminConfig;
  if (!email) {
    logger.warn('[bootstrap] SUPER_ADMIN_EMAIL not configured. Skipping super admin check.');
    return;
  }

  const normalizedEmail = email.toLowerCase();
  const existing = await User.findOne({ email: normalizedEmail });

  if (!existing) {
    const generatedPassword =
      configuredPassword ||
      crypto
        .randomBytes(12)
        .toString('base64')
        .replace(/[^a-zA-Z0-9]/g, '')
        .slice(0, 16);
    const password = configuredPassword || generatedPassword;

    const user = await userService.createUser({
      email: normalizedEmail,
      name: name || 'Super Admin',
      password,
      role: 'superadmin',
      organizationId: new mongoose.Types.ObjectId().toString(),
    });

    logger.info({ email: normalizedEmail, userId: user.id }, '[bootstrap] Super admin account created');
    if (!configuredPassword) {
      logger.warn(`[bootstrap] Generated temporary super admin password for ${normalizedEmail}: ${password}`);
    }
    return;
  }

  if (existing.role !== 'superadmin') {
    existing.role = 'superadmin';
    if (!existing.organizationId) {
      existing.organizationId = new mongoose.Types.ObjectId().toString();
    }
    await existing.save();
    logger.info({ email: normalizedEmail, userId: existing.id }, '[bootstrap] Promoted existing account to super admin');
  }
};

module.exports = {
  ensureSuperAdmin,
};
