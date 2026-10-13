/**
 * Object storage behind one interface.
 *
 *   s3    — production (AWS S3, private bucket, short-lived presigned GETs)
 *   local — development and tests (files under LOCAL_STORAGE_DIR, served by
 *           the API through HMAC-signed, expiring URLs)
 *
 * Keys for new objects are always tenant-prefixed and unique:
 *   ws/{workspaceId}/requests/{caseId}/{caseDocumentId}/{uuid}-{slug}
 *   ws/{workspaceId}/signatures/{requestId|uploads}/{uuid}-{slug}
 *   ws/{workspaceId}/assets/{uuid}-{slug}
 * Legacy keys ("{workspaceName}/{clientName}/documents/{file}") stay readable;
 * the API authorizes them through the DB row that references them.
 */
import { randomUUID } from 'crypto'
import { mkdir, readFile, writeFile, rm } from 'fs/promises'
import { dirname, resolve, sep } from 'path'
import {
  S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, DeleteObjectsCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { config } from './config.mjs'
import { hmacSha256, safeEqual } from './lib/crypto.mjs'
import { storageSlug, contentDisposition } from './lib/files.mjs'

const DEFAULT_URL_TTL = 300 // seconds

// ── Key builders ────────────────────────────────────────────
export const keys = {
  requestFile: (workspaceId, caseId, caseDocumentId, fileName) =>
    `ws/${workspaceId}/requests/${caseId}/${caseDocumentId}/${randomUUID()}-${storageSlug(fileName)}`,
  signatureFile: (workspaceId, scope, fileName) =>
    `ws/${workspaceId}/signatures/${scope}/${randomUUID()}-${storageSlug(fileName)}`,
  asset: (workspaceId, fileName) => `ws/${workspaceId}/assets/${randomUUID()}-${storageSlug(fileName)}`,
}

export function isWorkspaceKey(key, workspaceId) {
  return typeof key === 'string' && key.startsWith(`ws/${workspaceId}/`) && !key.includes('..')
}

// ── S3 driver ───────────────────────────────────────────────
function s3Driver() {
  const client = new S3Client({
    region: config.storage.region,
    credentials: { accessKeyId: config.storage.accessKeyId, secretAccessKey: config.storage.secretAccessKey },
  })
  const Bucket = config.storage.bucket
  return {
    name: 's3',
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: 'AES256' }))
    },
    async get(key) {
      const res = await client.send(new GetObjectCommand({ Bucket, Key: key }))
      const chunks = []
      for await (const chunk of res.Body) chunks.push(chunk)
      return { buffer: Buffer.concat(chunks), contentType: res.ContentType }
    },
    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }))
    },
    async removeMany(list) {
      for (let i = 0; i < list.length; i += 1000) {
        await client.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: list.slice(i, i + 1000).map((Key) => ({ Key })) } }))
      }
    },
    async url(key, { fileName, disposition = 'inline', contentType, expiresIn = DEFAULT_URL_TTL }) {
      const cmd = new GetObjectCommand({
        Bucket,
        Key: key,
        ResponseContentDisposition: fileName ? contentDisposition(fileName, disposition) : undefined,
        ResponseContentType: contentType,
      })
      return getSignedUrl(client, cmd, { expiresIn })
    },
  }
}

// ── Local driver ────────────────────────────────────────────
function localDriver() {
  const base = resolve(config.storage.localDir)
  const pathFor = (key) => {
    const p = resolve(base, key)
    if (!p.startsWith(base + sep)) throw new Error('Invalid storage key')
    return p
  }
  return {
    name: 'local',
    async put(key, body, contentType) {
      const p = pathFor(key)
      await mkdir(dirname(p), { recursive: true })
      await writeFile(p, body)
      await writeFile(p + '.meta.json', JSON.stringify({ contentType }))
    },
    async get(key) {
      const p = pathFor(key)
      const buffer = await readFile(p)
      let contentType = 'application/octet-stream'
      try { contentType = JSON.parse(await readFile(p + '.meta.json', 'utf8')).contentType || contentType } catch { /* no meta */ }
      return { buffer, contentType }
    },
    async remove(key) {
      const p = pathFor(key)
      await rm(p, { force: true })
      await rm(p + '.meta.json', { force: true })
    },
    async removeMany(list) {
      for (const k of list) await this.remove(k)
    },
    async url(key, { fileName, disposition = 'inline', contentType, expiresIn = DEFAULT_URL_TTL }) {
      const exp = Math.floor(Date.now() / 1000) + expiresIn
      const payload = Buffer.from(JSON.stringify({ k: key, e: exp, n: fileName || null, d: disposition, t: contentType || null })).toString('base64url')
      const sig = hmacSha256(config.sessionSecret, `local-file:${payload}`)
      return `/api/files/local/${payload}.${sig}`
    },
  }
}

/** Verify a signed local-file URL token; returns its payload or null. */
export function verifyLocalFileToken(token) {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!safeEqual(sig, hmacSha256(config.sessionSecret, `local-file:${payload}`))) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (data.e * 1000 < Date.now()) return null
    return data
  } catch {
    return null
  }
}

const driver = config.storage.driver === 'local' ? localDriver() : s3Driver()

export const storage = {
  driverName: driver.name,
  put: (key, body, contentType) => driver.put(key, body, contentType),
  get: (key) => driver.get(key),
  remove: (key) => driver.remove(key),
  removeMany: (list) => (list.length ? driver.removeMany(list) : Promise.resolve()),
  /** Short-lived URL for a key the caller has already been authorized to read. */
  url: (key, opts = {}) => driver.url(key, opts),
}
