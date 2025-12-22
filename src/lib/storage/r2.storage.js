/**
 * Cloudflare R2 Storage Provider
 * 
 * S3-compatible storage client for Cloudflare R2.
 * Uses AWS SDK v3 with R2 endpoint configuration.
 * 
 * @module lib/storage/r2
 */

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const httpStatus = require('http-status');
const StorageInterface = require('./storage.interface');
const config = require('../../config/config');
const logger = require('../../config/logger');
const ApiError = require('../../utils/ApiError');

/**
 * R2 Storage Provider
 * @extends StorageInterface
 */
class R2Storage extends StorageInterface {
  constructor() {
    super();
    this.client = null;
    this.bucket = config.storage.r2.bucket;
    this.publicUrl = config.storage.r2.publicUrl;
  }

  /**
   * Get or create S3 client configured for R2
   * @returns {S3Client}
   */
  getClient() {
    if (this.client) return this.client;

    const { accountId, accessKeyId, secretAccessKey } = config.storage.r2;

    logger.debug({
      hasAccountId: !!accountId,
      hasAccessKeyId: !!accessKeyId,
      hasSecretAccessKey: !!secretAccessKey,
      storageProvider: config.storage.provider,
    }, 'R2 credentials check');

    if (!accountId || !accessKeyId || !secretAccessKey) {
      logger.error({
        accountId: accountId ? 'set' : 'missing',
        accessKeyId: accessKeyId ? 'set' : 'missing',
        secretAccessKey: secretAccessKey ? 'set' : 'missing',
      }, 'R2 storage credentials missing');
      throw new ApiError(
        httpStatus.SERVICE_UNAVAILABLE,
        'R2 storage not configured. Missing credentials.'
      );
    }

    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    logger.info('R2 storage client initialized');
    return this.client;
  }

  /**
   * Build storage key with organization prefix
   * @param {string} orgId - Organization ID
   * @param {string} path - Path within organization
   * @returns {string}
   */
  buildKey(orgId, path) {
    return `${orgId}/${path}`.replace(/\/+/g, '/');
  }

  /**
   * Get public URL for a key
   * @param {string} key - Storage key
   * @returns {string|null}
   */
  getPublicUrl(key) {
    if (!this.publicUrl) return null;
    return `${this.publicUrl}/${key}`;
  }

  /**
   * Convert stream to buffer
   * @param {ReadableStream} stream
   * @returns {Promise<Buffer>}
   */
  async streamToBuffer(stream) {
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  /**
   * Upload a file to R2
   * @param {string} key - Storage key/path
   * @param {Buffer|ReadableStream} data - File data
   * @param {Object} options - Upload options
   * @returns {Promise<Object>}
   */
  async upload(key, data, options = {}) {
    const client = this.getClient();

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: data,
      ContentType: options.contentType || 'application/octet-stream',
      CacheControl: options.cacheControl || 'max-age=31536000',
      Metadata: options.metadata || {},
    });

    try {
      const response = await client.send(command);
      const size = Buffer.isBuffer(data) ? data.length : 0;

      logger.debug({ key, size }, 'File uploaded to R2');

      return {
        key,
        url: this.getPublicUrl(key) || `r2://${this.bucket}/${key}`,
        publicUrl: this.getPublicUrl(key),
        size,
        etag: response.ETag,
      };
    } catch (error) {
      logger.error({ error, key }, 'Failed to upload to R2');
      throw new ApiError(httpStatus.BAD_GATEWAY, `R2 upload failed: ${error.message}`);
    }
  }

  /**
   * Download a file from R2
   * @param {string} key - Storage key/path
   * @returns {Promise<Object>}
   */
  async download(key) {
    const client = this.getClient();

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    try {
      const response = await client.send(command);
      const data = await this.streamToBuffer(response.Body);

      return {
        data,
        contentType: response.ContentType,
        size: response.ContentLength,
        metadata: response.Metadata || {},
      };
    } catch (error) {
      if (error.name === 'NoSuchKey') {
        throw new ApiError(httpStatus.NOT_FOUND, `File not found: ${key}`);
      }
      logger.error({ error, key }, 'Failed to download from R2');
      throw new ApiError(httpStatus.BAD_GATEWAY, `R2 download failed: ${error.message}`);
    }
  }

  /**
   * Delete a file from R2
   * @param {string} key - Storage key/path
   * @returns {Promise<void>}
   */
  async delete(key) {
    const client = this.getClient();

    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    try {
      await client.send(command);
      logger.debug({ key }, 'File deleted from R2');
    } catch (error) {
      logger.error({ error, key }, 'Failed to delete from R2');
      throw new ApiError(httpStatus.BAD_GATEWAY, `R2 delete failed: ${error.message}`);
    }
  }

  /**
   * Delete multiple files from R2
   * @param {string[]} keys - Array of storage keys
   * @returns {Promise<void>}
   */
  async deleteMany(keys) {
    if (keys.length === 0) return;

    const client = this.getClient();

    const command = new DeleteObjectsCommand({
      Bucket: this.bucket,
      Delete: {
        Objects: keys.map((key) => ({ Key: key })),
        Quiet: true,
      },
    });

    try {
      await client.send(command);
      logger.debug({ count: keys.length }, 'Files deleted from R2');
    } catch (error) {
      logger.error({ error, count: keys.length }, 'Failed to delete files from R2');
      throw new ApiError(httpStatus.BAD_GATEWAY, `R2 bulk delete failed: ${error.message}`);
    }
  }

  /**
   * Check if a file exists in R2
   * @param {string} key - Storage key/path
   * @returns {Promise<boolean>}
   */
  async exists(key) {
    const client = this.getClient();

    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    try {
      await client.send(command);
      return true;
    } catch (error) {
      if (error.name === 'NotFound' || error.name === 'NoSuchKey') {
        return false;
      }
      throw error;
    }
  }

  /**
   * List files in R2
   * @param {Object} options - List options
   * @returns {Promise<Object>}
   */
  async list(options = {}) {
    const client = this.getClient();

    const command = new ListObjectsV2Command({
      Bucket: this.bucket,
      Prefix: options.prefix,
      MaxKeys: options.maxKeys || 1000,
      ContinuationToken: options.continuationToken,
    });

    try {
      const response = await client.send(command);

      return {
        objects: (response.Contents || []).map((obj) => ({
          key: obj.Key,
          size: obj.Size,
          lastModified: obj.LastModified,
        })),
        nextContinuationToken: response.NextContinuationToken,
        isTruncated: response.IsTruncated || false,
      };
    } catch (error) {
      logger.error({ error, prefix: options.prefix }, 'Failed to list R2 objects');
      throw new ApiError(httpStatus.BAD_GATEWAY, `R2 list failed: ${error.message}`);
    }
  }

  /**
   * Get a presigned URL for downloading
   * @param {string} key - Storage key/path
   * @param {Object} options - URL options
   * @returns {Promise<string>}
   */
  async getPresignedDownloadUrl(key, options = {}) {
    const client = this.getClient();
    const expiresIn = options.expiresIn || 3600;

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    try {
      return await getSignedUrl(client, command, { expiresIn });
    } catch (error) {
      logger.error({ error, key }, 'Failed to generate presigned download URL');
      throw new ApiError(httpStatus.BAD_GATEWAY, `Failed to generate download URL: ${error.message}`);
    }
  }

  /**
   * Get a presigned URL for uploading
   * @param {string} key - Storage key/path
   * @param {Object} options - URL options
   * @returns {Promise<string>}
   */
  async getPresignedUploadUrl(key, options = {}) {
    const client = this.getClient();
    const expiresIn = options.expiresIn || 3600;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: options.contentType,
    });

    try {
      return await getSignedUrl(client, command, { expiresIn });
    } catch (error) {
      logger.error({ error, key }, 'Failed to generate presigned upload URL');
      throw new ApiError(httpStatus.BAD_GATEWAY, `Failed to generate upload URL: ${error.message}`);
    }
  }

  /**
   * Copy a file within R2
   * @param {string} sourceKey - Source key
   * @param {string} destinationKey - Destination key
   * @returns {Promise<void>}
   */
  async copy(sourceKey, destinationKey) {
    const client = this.getClient();

    const command = new CopyObjectCommand({
      Bucket: this.bucket,
      CopySource: `${this.bucket}/${sourceKey}`,
      Key: destinationKey,
    });

    try {
      await client.send(command);
      logger.debug({ sourceKey, destinationKey }, 'File copied in R2');
    } catch (error) {
      logger.error({ error, sourceKey, destinationKey }, 'Failed to copy in R2');
      throw new ApiError(httpStatus.BAD_GATEWAY, `R2 copy failed: ${error.message}`);
    }
  }

  /**
   * Get file metadata
   * @param {string} key - Storage key/path
   * @returns {Promise<Object>}
   */
  async getMetadata(key) {
    const client = this.getClient();

    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    try {
      const response = await client.send(command);

      return {
        size: response.ContentLength,
        contentType: response.ContentType,
        lastModified: response.LastModified,
        metadata: response.Metadata || {},
        etag: response.ETag,
      };
    } catch (error) {
      if (error.name === 'NotFound' || error.name === 'NoSuchKey') {
        throw new ApiError(httpStatus.NOT_FOUND, `File not found: ${key}`);
      }
      throw new ApiError(httpStatus.BAD_GATEWAY, `R2 metadata fetch failed: ${error.message}`);
    }
  }
}

module.exports = R2Storage;

