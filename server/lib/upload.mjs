import multer from 'multer'
import { config } from '../config.mjs'

/**
 * Single-file, in-memory multipart parser. Browsers send UTF-8 filenames, so
 * decode them as UTF-8 (multer's default is latin1, which garbles Hebrew).
 */
export function singleFile(maxBytes = config.storage.maxUploadBytes) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1, fields: 10, fieldSize: 64 * 1024 },
    defParamCharset: 'utf8',
  }).single('file')
}
