/**
 * Storage Factory
 * 
 * Returns the appropriate storage provider based on configuration.
 * Supports: local, r2 (Cloudflare), s3 (AWS)
 * 
 * @module lib/storage
 */

const config = require('../../config/config');
const logger = require('../../config/logger');
const LocalStorage = require('./local.storage');
const R2Storage = require('./r2.storage');

/** @type {import('./storage.interface')} */
let storageInstance = null;

/**
 * Get storage provider instance (singleton)
 * @returns {import('./storage.interface')}
 */
const getStorage = () => {
  if (storageInstance) return storageInstance;

  const provider = config.storage.provider || 'local';

  switch (provider) {
    case 'r2':
      logger.info('Using Cloudflare R2 storage provider');
      storageInstance = new R2Storage();
      break;
    case 's3':
      // S3 uses same interface as R2, just with different endpoint
      logger.info('Using AWS S3 storage provider');
      storageInstance = new R2Storage(); // R2Storage is S3-compatible
      break;
    case 'local':
    default:
      logger.info('Using local file storage provider');
      storageInstance = new LocalStorage();
      break;
  }

  return storageInstance;
};

/**
 * Storage path helpers for Sitewise
 */
const storagePaths = {
  /**
   * Build inspection photo path
   * @param {string} orgId - Organization ID
   * @param {string} inspectionId - Inspection ID
   * @param {string} roomId - Room ID
   * @param {string} filename - Photo filename
   * @returns {string}
   */
  inspectionPhoto: (orgId, inspectionId, roomId, filename) =>
    `${orgId}/inspections/${inspectionId}/photos/${roomId}/${filename}`,

  /**
   * Build inspection thumbnail path
   * @param {string} orgId - Organization ID
   * @param {string} inspectionId - Inspection ID
   * @param {string} roomId - Room ID
   * @param {string} filename - Thumbnail filename
   * @returns {string}
   */
  inspectionThumbnail: (orgId, inspectionId, roomId, filename) =>
    `${orgId}/inspections/${inspectionId}/thumbnails/${roomId}/${filename}`,

  /**
   * Build report preset sample path
   * @param {string} orgId - Organization ID
   * @param {string} presetId - Preset ID
   * @param {string} filename - Sample filename
   * @returns {string}
   */
  presetSample: (orgId, presetId, filename) =>
    `${orgId}/presets/${presetId}/${filename}`,

  /**
   * Build generated report path
   * @param {string} orgId - Organization ID
   * @param {string} reportId - Report ID
   * @param {number} version - Report version
   * @returns {string}
   */
  generatedReport: (orgId, reportId, version) =>
    `${orgId}/reports/${reportId}/v${version}.pdf`,

  /**
   * Build organization logo path
   * @param {string} orgId - Organization ID
   * @param {string} filename - Logo filename
   * @returns {string}
   */
  organizationLogo: (orgId, filename) =>
    `${orgId}/branding/${filename}`,
};

/**
 * Upload file with automatic path building
 * @param {string} key - Storage key
 * @param {Buffer|ReadableStream} data - File data
 * @param {Object} options - Upload options
 * @returns {Promise<Object>}
 */
const uploadFile = async (key, data, options = {}) => {
  const storage = getStorage();
  return storage.upload(key, data, options);
};

/**
 * Download file
 * @param {string} key - Storage key
 * @returns {Promise<Object>}
 */
const downloadFile = async (key) => {
  const storage = getStorage();
  return storage.download(key);
};

/**
 * Delete file
 * @param {string} key - Storage key
 * @returns {Promise<void>}
 */
const deleteFile = async (key) => {
  const storage = getStorage();
  return storage.delete(key);
};

/**
 * Get presigned download URL
 * @param {string} key - Storage key
 * @param {Object} options - URL options
 * @returns {Promise<string>}
 */
const getDownloadUrl = async (key, options = {}) => {
  const storage = getStorage();
  return storage.getPresignedDownloadUrl(key, options);
};

/**
 * Get presigned upload URL
 * @param {string} key - Storage key
 * @param {Object} options - URL options
 * @returns {Promise<string>}
 */
const getUploadUrl = async (key, options = {}) => {
  const storage = getStorage();
  return storage.getPresignedUploadUrl(key, options);
};

/**
 * Check if file exists
 * @param {string} key - Storage key
 * @returns {Promise<boolean>}
 */
const fileExists = async (key) => {
  const storage = getStorage();
  return storage.exists(key);
};

/**
 * List files
 * @param {Object} options - List options
 * @returns {Promise<Object>}
 */
const listFiles = async (options = {}) => {
  const storage = getStorage();
  return storage.list(options);
};

module.exports = {
  getStorage,
  storagePaths,
  uploadFile,
  downloadFile,
  deleteFile,
  getDownloadUrl,
  getUploadUrl,
  fileExists,
  listFiles,
  // Export classes for direct instantiation if needed
  LocalStorage,
  R2Storage,
};

