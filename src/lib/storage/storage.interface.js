/**
 * Storage Interface
 * 
 * Abstract interface for storage providers.
 * Implementations: LocalStorage, R2Storage, S3Storage
 * 
 * @module lib/storage/interface
 */

/**
 * @typedef {Object} UploadOptions
 * @property {string} [contentType] - MIME type of the file
 * @property {Object} [metadata] - Custom metadata
 * @property {string} [cacheControl] - Cache-Control header
 * @property {boolean} [public] - Whether file should be publicly accessible
 */

/**
 * @typedef {Object} UploadResult
 * @property {string} key - Storage key/path
 * @property {string} url - URL to access the file
 * @property {string} [publicUrl] - Public URL if available
 * @property {number} size - File size in bytes
 * @property {string} etag - ETag of the uploaded file
 */

/**
 * @typedef {Object} DownloadResult
 * @property {Buffer} data - File data
 * @property {string} contentType - MIME type
 * @property {number} size - File size in bytes
 * @property {Object} metadata - Custom metadata
 */

/**
 * @typedef {Object} ListOptions
 * @property {string} [prefix] - Key prefix to filter
 * @property {number} [maxKeys] - Maximum number of keys to return
 * @property {string} [continuationToken] - Token for pagination
 */

/**
 * @typedef {Object} ListResult
 * @property {Array<{key: string, size: number, lastModified: Date}>} objects
 * @property {string} [nextContinuationToken] - Token for next page
 * @property {boolean} isTruncated - Whether more results exist
 */

/**
 * @typedef {Object} PresignedUrlOptions
 * @property {number} [expiresIn] - URL expiration in seconds (default: 3600)
 * @property {string} [contentType] - Content-Type for upload URLs
 */

/**
 * Storage Provider Interface
 * @interface
 */
class StorageInterface {
  /**
   * Upload a file to storage
   * @param {string} key - Storage key/path
   * @param {Buffer|ReadableStream} data - File data
   * @param {UploadOptions} [options] - Upload options
   * @returns {Promise<UploadResult>}
   */
  // eslint-disable-next-line no-unused-vars
  async upload(key, data, options = {}) {
    throw new Error('Method not implemented');
  }

  /**
   * Download a file from storage
   * @param {string} key - Storage key/path
   * @returns {Promise<DownloadResult>}
   */
  // eslint-disable-next-line no-unused-vars
  async download(key) {
    throw new Error('Method not implemented');
  }

  /**
   * Delete a file from storage
   * @param {string} key - Storage key/path
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async delete(key) {
    throw new Error('Method not implemented');
  }

  /**
   * Delete multiple files from storage
   * @param {string[]} keys - Array of storage keys
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async deleteMany(keys) {
    throw new Error('Method not implemented');
  }

  /**
   * Check if a file exists
   * @param {string} key - Storage key/path
   * @returns {Promise<boolean>}
   */
  // eslint-disable-next-line no-unused-vars
  async exists(key) {
    throw new Error('Method not implemented');
  }

  /**
   * List files in storage
   * @param {ListOptions} [options] - List options
   * @returns {Promise<ListResult>}
   */
  // eslint-disable-next-line no-unused-vars
  async list(options = {}) {
    throw new Error('Method not implemented');
  }

  /**
   * Get a presigned URL for downloading
   * @param {string} key - Storage key/path
   * @param {PresignedUrlOptions} [options] - URL options
   * @returns {Promise<string>}
   */
  // eslint-disable-next-line no-unused-vars
  async getPresignedDownloadUrl(key, options = {}) {
    throw new Error('Method not implemented');
  }

  /**
   * Get a presigned URL for uploading
   * @param {string} key - Storage key/path
   * @param {PresignedUrlOptions} [options] - URL options
   * @returns {Promise<string>}
   */
  // eslint-disable-next-line no-unused-vars
  async getPresignedUploadUrl(key, options = {}) {
    throw new Error('Method not implemented');
  }

  /**
   * Copy a file within storage
   * @param {string} sourceKey - Source key
   * @param {string} destinationKey - Destination key
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars
  async copy(sourceKey, destinationKey) {
    throw new Error('Method not implemented');
  }

  /**
   * Get file metadata
   * @param {string} key - Storage key/path
   * @returns {Promise<{size: number, contentType: string, lastModified: Date, metadata: Object}>}
   */
  // eslint-disable-next-line no-unused-vars
  async getMetadata(key) {
    throw new Error('Method not implemented');
  }
}

module.exports = StorageInterface;

