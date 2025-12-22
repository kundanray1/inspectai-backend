/**
 * Local File Storage Provider
 * 
 * File system-based storage for local development.
 * Compatible with StorageInterface for easy migration to R2/S3.
 * 
 * @module lib/storage/local
 */

/* eslint-disable security/detect-non-literal-fs-filename */
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const httpStatus = require('http-status');
const StorageInterface = require('./storage.interface');
const config = require('../../config/config');
const logger = require('../../config/logger');
const ApiError = require('../../utils/ApiError');

/**
 * Local Storage Provider
 * @extends StorageInterface
 */
class LocalStorage extends StorageInterface {
  constructor() {
    super();
    this.basePath = path.resolve(config.uploads.dir);
    this.ensureDirectory(this.basePath);
  }

  /**
   * Ensure directory exists
   * @param {string} dirPath
   */
  ensureDirectory(dirPath) {
    if (!fsSync.existsSync(dirPath)) {
      fsSync.mkdirSync(dirPath, { recursive: true });
    }
  }

  /**
   * Get full file path for a key
   * @param {string} key - Storage key
   * @returns {string}
   */
  getFilePath(key) {
    return path.join(this.basePath, key);
  }

  /**
   * Calculate file hash
   * @param {Buffer} data
   * @returns {string}
   */
  calculateEtag(data) {
    return `"${crypto.createHash('md5').update(data).digest('hex')}"`;
  }

  /**
   * Upload a file to local storage
   * @param {string} key - Storage key/path
   * @param {Buffer|ReadableStream} data - File data
   * @param {Object} options - Upload options
   * @returns {Promise<Object>}
   */
  async upload(key, data, options = {}) {
    const filePath = this.getFilePath(key);
    const dir = path.dirname(filePath);

    this.ensureDirectory(dir);

    try {
      let buffer = data;
      if (!Buffer.isBuffer(data)) {
        // Convert stream to buffer
        const chunks = [];
        for await (const chunk of data) {
          chunks.push(chunk);
        }
        buffer = Buffer.concat(chunks);
      }

      await fs.writeFile(filePath, buffer);

      // Save metadata
      const metadataPath = `${filePath}.meta.json`;
      const metadata = {
        contentType: options.contentType || 'application/octet-stream',
        size: buffer.length,
        uploadedAt: new Date().toISOString(),
        customMetadata: options.metadata || {},
      };
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

      logger.debug({ key, size: buffer.length }, 'File uploaded to local storage');

      return {
        key,
        url: `file://${filePath}`,
        publicUrl: null,
        size: buffer.length,
        etag: this.calculateEtag(buffer),
      };
    } catch (error) {
      logger.error({ error, key }, 'Failed to upload to local storage');
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Local storage upload failed: ${error.message}`);
    }
  }

  /**
   * Download a file from local storage
   * @param {string} key - Storage key/path
   * @returns {Promise<Object>}
   */
  async download(key) {
    const filePath = this.getFilePath(key);
    const metadataPath = `${filePath}.meta.json`;

    try {
      const data = await fs.readFile(filePath);
      let metadata = { contentType: 'application/octet-stream', customMetadata: {} };

      try {
        const metaContent = await fs.readFile(metadataPath, 'utf-8');
        metadata = JSON.parse(metaContent);
      } catch {
        // Metadata file doesn't exist, use defaults
      }

      return {
        data,
        contentType: metadata.contentType,
        size: data.length,
        metadata: metadata.customMetadata || {},
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new ApiError(httpStatus.NOT_FOUND, `File not found: ${key}`);
      }
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Local storage download failed: ${error.message}`);
    }
  }

  /**
   * Delete a file from local storage
   * @param {string} key - Storage key/path
   * @returns {Promise<void>}
   */
  async delete(key) {
    const filePath = this.getFilePath(key);
    const metadataPath = `${filePath}.meta.json`;

    try {
      await fs.unlink(filePath);
      try {
        await fs.unlink(metadataPath);
      } catch {
        // Metadata file might not exist
      }
      logger.debug({ key }, 'File deleted from local storage');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Local storage delete failed: ${error.message}`);
      }
    }
  }

  /**
   * Delete multiple files from local storage
   * @param {string[]} keys - Array of storage keys
   * @returns {Promise<void>}
   */
  async deleteMany(keys) {
    await Promise.all(keys.map((key) => this.delete(key)));
  }

  /**
   * Check if a file exists
   * @param {string} key - Storage key/path
   * @returns {Promise<boolean>}
   */
  async exists(key) {
    const filePath = this.getFilePath(key);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * List files in local storage
   * @param {Object} options - List options
   * @returns {Promise<Object>}
   */
  async list(options = {}) {
    const prefix = options.prefix || '';
    const searchPath = this.getFilePath(prefix);
    const maxKeys = options.maxKeys || 1000;

    try {
      const results = [];
      await this.walkDirectory(searchPath, prefix, results, maxKeys);

      return {
        objects: results.slice(0, maxKeys),
        nextContinuationToken: null,
        isTruncated: results.length > maxKeys,
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return { objects: [], isTruncated: false };
      }
      throw error;
    }
  }

  /**
   * Recursively walk directory
   * @param {string} dirPath
   * @param {string} prefix
   * @param {Array} results
   * @param {number} maxKeys
   */
  async walkDirectory(dirPath, prefix, results, maxKeys) {
    if (results.length >= maxKeys) return;

    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        if (results.length >= maxKeys) break;
        if (entry.name.endsWith('.meta.json')) continue;

        const fullPath = path.join(dirPath, entry.name);
        const relativePath = path.relative(this.basePath, fullPath);

        if (entry.isDirectory()) {
          // eslint-disable-next-line no-await-in-loop
          await this.walkDirectory(fullPath, prefix, results, maxKeys);
        } else {
          // eslint-disable-next-line no-await-in-loop
          const stats = await fs.stat(fullPath);
          results.push({
            key: relativePath,
            size: stats.size,
            lastModified: stats.mtime,
          });
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  /**
   * Get a presigned URL for downloading (returns local file path for local storage)
   * @param {string} key - Storage key/path
   * @param {Object} options - URL options
   * @returns {Promise<string>}
   */
  async getPresignedDownloadUrl(key, options = {}) {
    const filePath = this.getFilePath(key);
    const exists = await this.exists(key);
    if (!exists) {
      throw new ApiError(httpStatus.NOT_FOUND, `File not found: ${key}`);
    }
    // For local storage, return a token-based URL that can be used with an API endpoint
    const token = crypto.randomBytes(32).toString('hex');
    const expiresIn = options.expiresIn || 3600;
    // In a real implementation, you'd store this token with expiry
    return `/api/v1/storage/download/${token}?key=${encodeURIComponent(key)}&expires=${Date.now() + expiresIn * 1000}`;
  }

  /**
   * Get a presigned URL for uploading
   * @param {string} key - Storage key/path
   * @param {Object} options - URL options
   * @returns {Promise<string>}
   */
  async getPresignedUploadUrl(key, options = {}) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresIn = options.expiresIn || 3600;
    return `/api/v1/storage/upload/${token}?key=${encodeURIComponent(key)}&expires=${Date.now() + expiresIn * 1000}`;
  }

  /**
   * Copy a file within local storage
   * @param {string} sourceKey - Source key
   * @param {string} destinationKey - Destination key
   * @returns {Promise<void>}
   */
  async copy(sourceKey, destinationKey) {
    const sourcePath = this.getFilePath(sourceKey);
    const destPath = this.getFilePath(destinationKey);
    const destDir = path.dirname(destPath);

    this.ensureDirectory(destDir);

    try {
      await fs.copyFile(sourcePath, destPath);
      // Copy metadata too
      try {
        await fs.copyFile(`${sourcePath}.meta.json`, `${destPath}.meta.json`);
      } catch {
        // Metadata might not exist
      }
      logger.debug({ sourceKey, destinationKey }, 'File copied in local storage');
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new ApiError(httpStatus.NOT_FOUND, `Source file not found: ${sourceKey}`);
      }
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Local storage copy failed: ${error.message}`);
    }
  }

  /**
   * Get file metadata
   * @param {string} key - Storage key/path
   * @returns {Promise<Object>}
   */
  async getMetadata(key) {
    const filePath = this.getFilePath(key);
    const metadataPath = `${filePath}.meta.json`;

    try {
      const stats = await fs.stat(filePath);
      let metadata = { contentType: 'application/octet-stream', customMetadata: {} };

      try {
        const metaContent = await fs.readFile(metadataPath, 'utf-8');
        metadata = JSON.parse(metaContent);
      } catch {
        // Metadata file doesn't exist
      }

      const data = await fs.readFile(filePath);

      return {
        size: stats.size,
        contentType: metadata.contentType,
        lastModified: stats.mtime,
        metadata: metadata.customMetadata || {},
        etag: this.calculateEtag(data),
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new ApiError(httpStatus.NOT_FOUND, `File not found: ${key}`);
      }
      throw new ApiError(httpStatus.INTERNAL_SERVER_ERROR, `Metadata fetch failed: ${error.message}`);
    }
  }
}

module.exports = LocalStorage;

