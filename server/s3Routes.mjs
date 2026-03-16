/**
 * S3 Storage API Routes
 * Endpoints for the frontend to interact with S3 via presigned URLs and
 * direct server-side uploads.
 */

import express from 'express';
import multer from 'multer';
import {
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  uploadBuffer,
  downloadBuffer,
  deleteObject,
  deleteObjects,
  listObjects,
  buildReadablePath,
  buildSignaturePath,
  buildAssetPath,
  sanitizeSegment,
} from './s3Service.mjs';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50 MB

// ── Presigned Upload URL ────────────────────────────────────────────────
// Frontend calls this to get a PUT URL, then uploads directly to S3
router.post('/presign-upload', async (req, res) => {
  try {
    const { key, contentType, pathInfo } = req.body;

    let finalKey = key;
    // If pathInfo is provided, build a readable path
    if (pathInfo) {
      if (pathInfo.type === 'document') {
        finalKey = buildReadablePath(pathInfo);
      } else if (pathInfo.type === 'signature') {
        finalKey = buildSignaturePath(pathInfo);
      } else if (pathInfo.type === 'asset') {
        finalKey = buildAssetPath(pathInfo);
      }
    }

    const url = await getPresignedUploadUrl(finalKey, contentType || 'application/octet-stream');
    res.json({ success: true, url, key: finalKey });
  } catch (err) {
    console.error('[S3] Presign upload error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Presigned Download URL ──────────────────────────────────────────────
router.post('/presign-download', async (req, res) => {
  try {
    const { key, expiresIn } = req.body;
    if (!key) return res.status(400).json({ success: false, error: 'Missing key' });
    const url = await getPresignedDownloadUrl(key, expiresIn || 3600);
    res.json({ success: true, url });
  } catch (err) {
    console.error('[S3] Presign download error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Direct Upload (server-side) — for small files or server-generated content ─
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, error: 'No file provided' });

    let key = req.body.key;
    // If pathInfo JSON is provided, build readable path
    if (req.body.pathInfo) {
      const pathInfo = JSON.parse(req.body.pathInfo);
      if (pathInfo.type === 'document') {
        key = buildReadablePath(pathInfo);
      } else if (pathInfo.type === 'signature') {
        key = buildSignaturePath(pathInfo);
      } else if (pathInfo.type === 'asset') {
        key = buildAssetPath(pathInfo);
      }
    }

    if (!key) return res.status(400).json({ success: false, error: 'Missing key' });

    await uploadBuffer(key, file.buffer, file.mimetype);
    res.json({ success: true, key, size: file.size });
  } catch (err) {
    console.error('[S3] Upload error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Upload raw buffer (JSON body with base64 data) ──────────────────────
router.post('/upload-buffer', async (req, res) => {
  try {
    const { key, base64Data, contentType, pathInfo } = req.body;

    let finalKey = key;
    if (pathInfo) {
      if (pathInfo.type === 'document') {
        finalKey = buildReadablePath(pathInfo);
      } else if (pathInfo.type === 'signature') {
        finalKey = buildSignaturePath(pathInfo);
      } else if (pathInfo.type === 'asset') {
        finalKey = buildAssetPath(pathInfo);
      }
    }

    if (!finalKey) return res.status(400).json({ success: false, error: 'Missing key' });
    if (!base64Data) return res.status(400).json({ success: false, error: 'Missing base64Data' });

    const buffer = Buffer.from(base64Data, 'base64');
    await uploadBuffer(finalKey, buffer, contentType || 'application/octet-stream');
    res.json({ success: true, key: finalKey, size: buffer.length });
  } catch (err) {
    console.error('[S3] Upload buffer error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Download file (proxy through server) ────────────────────────────────
router.get('/download', async (req, res) => {
  try {
    const key = req.query.key;
    if (!key) return res.status(400).json({ success: false, error: 'Missing key' });

    const { buffer, contentType } = await downloadBuffer(key);
    res.setHeader('Content-Type', contentType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${key.split('/').pop()}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[S3] Download error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Delete file(s) ─────────────────────────────────────────────────────
router.post('/delete', async (req, res) => {
  try {
    const { key, keys } = req.body;
    if (keys && keys.length > 0) {
      await deleteObjects(keys);
    } else if (key) {
      await deleteObject(key);
    } else {
      return res.status(400).json({ success: false, error: 'Missing key or keys' });
    }
    res.json({ success: true });
  } catch (err) {
    console.error('[S3] Delete error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── List files ──────────────────────────────────────────────────────────
router.post('/list', async (req, res) => {
  try {
    const { prefix } = req.body;
    if (!prefix) return res.status(400).json({ success: false, error: 'Missing prefix' });
    const objects = await listObjects(prefix);
    res.json({ success: true, objects });
  } catch (err) {
    console.error('[S3] List error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
