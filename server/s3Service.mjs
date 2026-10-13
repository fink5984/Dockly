/**
 * AWS S3 Storage Service
 * Handles all S3 operations: upload, download (presigned URLs), delete, list
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// ── S3 Client ───────────────────────────────────────────────────────────
const BUCKET = process.env.AWS_S3_BUCKET || 'dockly-documents';
const REGION = process.env.AWS_S3_REGION || 'il-central-1';

const s3 = new S3Client({
  region: REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});

/**
 * Sanitise a path segment — keep Unicode letters/digits, replace unsafe chars.
 * Allows Hebrew, Arabic and other scripts while removing slashes, etc.
 */
function sanitizeSegment(name) {
  if (!name) return '_';
  return name
    .replace(/[\/\\:*?"<>|#%&{}$!'@+`=]/g, '_') // remove unsafe chars
    .replace(/\s+/g, ' ')                         // collapse whitespace
    .trim() || '_';
}

/**
 * Build a human-readable storage path for documents.
 * Pattern: {workspaceName}/{clientName}/documents/{fileName}
 */
export function buildReadablePath({ workspaceName, clientName, caseType, documentTypeName, fileName }) {
  const segments = [
    sanitizeSegment(workspaceName),
    sanitizeSegment(clientName),
    'documents',
    sanitizeSegment(fileName),
  ];
  return segments.join('/');
}

/**
 * Build path for signatures.
 * Pattern: {workspaceName}/{clientName}/signatures/{fileName}
 */
export function buildSignaturePath({ workspaceName, clientName, title, fileName }) {
  const segments = [
    sanitizeSegment(workspaceName),
    sanitizeSegment(clientName),
    'signatures',
    sanitizeSegment(fileName),
  ];
  return segments.join('/');
}

/**
 * Build path for workspace assets (logos, etc.).
 * Pattern: {workspaceName}/_assets/{fileName}
 */
export function buildAssetPath({ workspaceName, fileName }) {
  return `${sanitizeSegment(workspaceName)}/_assets/${sanitizeSegment(fileName)}`;
}

// ── Core S3 Operations ──────────────────────────────────────────────────

/**
 * Generate a presigned URL for uploading a file (PUT).
 */
export async function getPresignedUploadUrl(key, contentType, expiresIn = 3600) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });
  const url = await getSignedUrl(s3, command, { expiresIn });
  return url;
}

/**
 * Generate a presigned URL for downloading / viewing a file (GET).
 */
export async function getPresignedDownloadUrl(key, expiresIn = 3600) {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });
  const url = await getSignedUrl(s3, command, { expiresIn });
  return url;
}

/**
 * Upload a buffer/stream directly to S3 (for server-side uploads).
 */
export async function uploadBuffer(key, buffer, contentType) {
  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'max-age=3600',
  });
  await s3.send(command);
  return key;
}

/**
 * Download a file from S3 as a Buffer.
 */
export async function downloadBuffer(key) {
  const command = new GetObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });
  const response = await s3.send(command);
  // Convert readable stream to buffer
  const chunks = [];
  for await (const chunk of response.Body) {
    chunks.push(chunk);
  }
  return {
    buffer: Buffer.concat(chunks),
    contentType: response.ContentType,
    contentLength: response.ContentLength,
  };
}

/**
 * Delete a single file from S3.
 */
export async function deleteObject(key) {
  const command = new DeleteObjectCommand({
    Bucket: BUCKET,
    Key: key,
  });
  await s3.send(command);
}

/**
 * Delete multiple files from S3.
 */
export async function deleteObjects(keys) {
  if (!keys || keys.length === 0) return;
  const command = new DeleteObjectsCommand({
    Bucket: BUCKET,
    Delete: {
      Objects: keys.map((k) => ({ Key: k })),
    },
  });
  await s3.send(command);
}

/**
 * List files under a given prefix.
 */
export async function listObjects(prefix) {
  const command = new ListObjectsV2Command({
    Bucket: BUCKET,
    Prefix: prefix,
  });
  const response = await s3.send(command);
  return (response.Contents || []).map((obj) => ({
    key: obj.Key,
    size: obj.Size,
    lastModified: obj.LastModified?.toISOString(),
  }));
}

/**
 * Check if an object exists.
 */
export async function objectExists(key) {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

export { BUCKET, REGION, sanitizeSegment };
