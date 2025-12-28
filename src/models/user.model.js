const mongoose = require('mongoose');
const validator = require('validator');
const bcrypt = require('bcryptjs');
const { toJSON, paginate } = require('./plugins');
const { roles } = require('../config/roles');

const userSchema = mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      validate(value) {
        if (!validator.isEmail(value)) {
          throw new Error('Invalid email');
        }
      },
    },
    password: {
      type: String,
      required: true,
      trim: true,
      minlength: 8,
      validate(value) {
        if (!value.match(/\d/) || !value.match(/[a-zA-Z]/)) {
          throw new Error('Password must contain at least one letter and one number');
        }
      },
      private: true, // used by the toJSON plugin
    },
    role: {
      type: String,
      enum: roles,
      default: 'admin',
    },
    organizationId: {
      type: String,
      required: true,
    },
    lastActiveAt: {
      type: Date,
    },
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    // Trial status tracking for freemium model
    trialStatus: {
      freeReportUsed: {
        type: Boolean,
        default: false,
      },
      freeReportGeneratedAt: {
        type: Date,
      },
      freeReportId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Report',
      },
    },
    // Usage statistics
    usageStats: {
      totalReportsGenerated: {
        type: Number,
        default: 0,
      },
      totalPhotosAnalyzed: {
        type: Number,
        default: 0,
      },
      totalInspectionsCreated: {
        type: Number,
        default: 0,
      },
      lastReportGeneratedAt: {
        type: Date,
      },
    },
    onboarding: {
      completed: {
        type: Boolean,
        default: false,
      },
      step: {
        type: Number,
        default: 0,
      },
      version: {
        type: Number,
        default: 1,
      },
      lastInspectionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Inspection',
      },
      lastSeenAt: {
        type: Date,
      },
      completedAt: {
        type: Date,
      },
    },
    // Agent profile for home inspectors
    agentProfile: {
      licenseNumber: {
        type: String,
        trim: true,
      },
      companyName: {
        type: String,
        trim: true,
      },
      specializations: {
        type: [String],
        default: [],
      },
      serviceAreas: {
        type: [String],
        default: [],
      },
      phone: {
        type: String,
        trim: true,
      },
      website: {
        type: String,
        trim: true,
      },
    },
  },
  {
    timestamps: true,
  }
);

// add plugin that converts mongoose to json
userSchema.plugin(toJSON);
userSchema.plugin(paginate);

/**
 * Check if email is taken
 * @param {string} email - The user's email
 * @param {ObjectId} [excludeUserId] - The id of the user to be excluded
 * @returns {Promise<boolean>}
 */
userSchema.statics.isEmailTaken = async function (email, excludeUserId) {
  const user = await this.findOne({ email, _id: { $ne: excludeUserId } });
  return !!user;
};

/**
 * Check if password matches the user's password
 * @param {string} password
 * @returns {Promise<boolean>}
 */
userSchema.methods.isPasswordMatch = async function (password) {
  const user = this;
  return bcrypt.compare(password, user.password);
};

userSchema.pre('save', async function (next) {
  const user = this;
  if (user.isModified('password')) {
    user.password = await bcrypt.hash(user.password, 8);
  }
  next();
});

/**
 * Check if user has used their free trial report
 * @returns {boolean}
 */
userSchema.methods.hasUsedFreeTrial = function () {
  return this.trialStatus && this.trialStatus.freeReportUsed === true;
};

/**
 * Mark free trial as used
 * @param {ObjectId} reportId - The report ID
 */
userSchema.methods.markFreeTrialUsed = async function (reportId) {
  this.trialStatus = {
    freeReportUsed: true,
    freeReportGeneratedAt: new Date(),
    freeReportId: reportId,
  };
  await this.save();
};

/**
 * Increment usage statistics
 * @param {string} statType - Type of stat to increment
 * @param {number} [amount=1] - Amount to increment by
 */
userSchema.methods.incrementUsage = async function (statType, amount = 1) {
  const update = {};
  const validStats = ['totalReportsGenerated', 'totalPhotosAnalyzed', 'totalInspectionsCreated'];
  
  if (!validStats.includes(statType)) {
    throw new Error(`Invalid stat type: ${statType}`);
  }

  update[`usageStats.${statType}`] = (this.usageStats && this.usageStats[statType]) || 0;
  update[`usageStats.${statType}`] += amount;
  
  if (statType === 'totalReportsGenerated') {
    update['usageStats.lastReportGeneratedAt'] = new Date();
  }

  await this.updateOne({ $set: update });
};

/**
 * @typedef User
 */
const User = mongoose.model('User', userSchema);

module.exports = User;
