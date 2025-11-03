const httpStatus = require('http-status');
const mongoose = require('mongoose');
const tokenService = require('./token.service');
const userService = require('./user.service');
const Token = require('../models/token.model');
const ApiError = require('../utils/ApiError');
const { tokenTypes } = require('../config/tokens');
const Subscription = require('../models/subscription.model');
const planService = require('./plan.service');

/**
 * Login with username and password
 * @param {string} email
 * @param {string} password
 * @returns {Promise<User>}
 */
const loginUserWithEmailAndPassword = async (email, password) => {
  const user = await userService.getUserByEmail(email);
  if (!user || !(await user.isPasswordMatch(password))) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Incorrect email or password');
  }
  user.lastActiveAt = new Date();
  await user.save();
  return user;
};

/**
 * Logout
 * @param {string} refreshToken
 * @returns {Promise}
 */
const logout = async (refreshToken) => {
  const refreshTokenDoc = await Token.findOne({ token: refreshToken, type: tokenTypes.REFRESH, blacklisted: false });
  if (!refreshTokenDoc) {
    throw new ApiError(httpStatus.NOT_FOUND, 'Not found');
  }
  await refreshTokenDoc.remove();
};

/**
 * Refresh auth tokens
 * @param {string} refreshToken
 * @returns {Promise<Object>}
 */
const refreshAuth = async (refreshToken) => {
  try {
    const refreshTokenDoc = await tokenService.verifyToken(refreshToken, tokenTypes.REFRESH);
    const user = await userService.getUserById(refreshTokenDoc.user);
    if (!user) {
      throw new Error();
    }
    await refreshTokenDoc.remove();
    return tokenService.generateAuthTokens(user);
  } catch (error) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Please authenticate');
  }
};

/**
 * Reset password
 * @param {string} resetPasswordToken
 * @param {string} newPassword
 * @returns {Promise}
 */
const resetPassword = async (resetPasswordToken, newPassword) => {
  try {
    const resetPasswordTokenDoc = await tokenService.verifyToken(resetPasswordToken, tokenTypes.RESET_PASSWORD);
    const user = await userService.getUserById(resetPasswordTokenDoc.user);
    if (!user) {
      throw new Error();
    }
    await userService.updateUserById(user.id, { password: newPassword });
    await Token.deleteMany({ user: user.id, type: tokenTypes.RESET_PASSWORD });
  } catch (error) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Password reset failed');
  }
};

/**
 * Verify email
 * @param {string} verifyEmailToken
 * @returns {Promise}
 */
const verifyEmail = async (verifyEmailToken) => {
  try {
    const verifyEmailTokenDoc = await tokenService.verifyToken(verifyEmailToken, tokenTypes.VERIFY_EMAIL);
    const user = await userService.getUserById(verifyEmailTokenDoc.user);
    if (!user) {
      throw new Error();
    }
    await Token.deleteMany({ user: user.id, type: tokenTypes.VERIFY_EMAIL });
    await userService.updateUserById(user.id, { isEmailVerified: true });
  } catch (error) {
    throw new ApiError(httpStatus.UNAUTHORIZED, 'Email verification failed');
  }
};

const createInspectUserAccount = async ({ email, name, password }) => {
  const existing = await userService.getUserByEmail(email.toLowerCase());
  if (existing) {
    throw new ApiError(httpStatus.CONFLICT, 'Email already registered');
  }

  const organizationId = new mongoose.Types.ObjectId().toString();
  const user = await userService.createUser({
    email: email.toLowerCase(),
    name,
    password,
    role: 'admin',
    organizationId,
  });

  const trialPlan = (await planService.getPlanBySlug('trial')) || {
    slug: 'trial',
    reportLimit: 10,
    trialDays: 7,
  };

  await Subscription.create({
    organizationId,
    stripeCustomerId: `demo_${organizationId}`,
    plan: trialPlan.slug,
    status: 'trialing',
    trialEndsAt: new Date(Date.now() + (trialPlan.trialDays || 7) * 24 * 60 * 60 * 1000),
    seats: 1,
    reportLimit: trialPlan.reportLimit || 10,
    usage: [],
  });

  return user;
};

const mapUserToDto = (user) => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  organizationId: user.organizationId,
  lastActiveAt: user.lastActiveAt ? user.lastActiveAt : undefined,
});

module.exports = {
  loginUserWithEmailAndPassword,
  logout,
  refreshAuth,
  resetPassword,
  verifyEmail,
  createInspectUserAccount,
  mapUserToDto,
};
