import { describe, it, expect } from 'vitest'
import { hashPassword, verifyPassword, passwordPolicyError } from '../lib/passwords.mjs'
import { signSession, verifySession, buildSessionPayload, parseCookies } from '../lib/session.mjs'
import { detectKind, validateUpload, cleanDisplayName, contentDisposition, storageSlug, allowedExtensions } from '../lib/files.mjs'
import { computeRequestStatus, summarizeDocuments, reviewTransition, canonicalDocStatus, clientCanUpload, isOverdue } from '../domain/requestStatus.mjs'
import { visualRuns, isRtlText, fontSegments } from '../signing/text.mjs'
import { viewToUser } from '../signing/pdf.mjs'
import { crc32, buildZip } from '../lib/zip.mjs'
import { normalizePhone } from '../messaging/phone.mjs'
import { isQuiet } from '../automation/scheduler.mjs'
import { samplePdf, tinyPng } from './helpers.mjs'

describe('passwords', () => {
  it('hashes and verifies', async () => {
    const h = await hashPassword('correct horse battery')
    expect(h.startsWith('scrypt$')).toBe(true)
    expect((await verifyPassword('correct horse battery', { password_hash: h })).ok).toBe(true)
    expect((await verifyPassword('wrong', { password_hash: h })).ok).toBe(false)
  })
  it('accepts a legacy plaintext once and asks for rehash', async () => {
    expect(await verifyPassword('legacy-pass', { password: 'legacy-pass' })).toEqual({ ok: true, needsRehash: true })
    expect(await verifyPassword('nope', { password: 'legacy-pass' })).toEqual({ ok: false, needsRehash: false })
  })
  it('rejects unknown accounts', async () => {
    expect((await verifyPassword('x', null)).ok).toBe(false)
  })
  it('enforces a minimum policy', () => {
    expect(passwordPolicyError('short')).toBeTruthy()
    expect(passwordPolicyError('password')).toBeTruthy()
    expect(passwordPolicyError('a much better passphrase')).toBeNull()
  })
})

describe('sessions', () => {
  const secret = 's'.repeat(40)
  it('round-trips and rejects tampering', () => {
    const p = buildSessionPayload({ profileId: 'p1', workspaceId: 'w1', sessionVersion: 1 }, 1)
    const t = signSession(p, secret)
    expect(verifySession(t, secret)?.sub).toBe('p1')
    const [body, sig] = t.split('.')
    const forged = Buffer.from(JSON.stringify({ ...p, sub: 'attacker' })).toString('base64url')
    expect(verifySession(`${forged}.${sig}`, secret)).toBeNull()
    expect(verifySession(`${body}.${sig}x`, secret)).toBeNull()
    expect(verifySession(t, 'other-secret'.repeat(4))).toBeNull()
  })
  it('expires', () => {
    const p = buildSessionPayload({ profileId: 'p', workspaceId: 'w', sessionVersion: 1 }, 1, Date.now() - 3 * 86400_000)
    expect(verifySession(signSession(p, secret), secret)).toBeNull()
  })
  it('parses cookies', () => {
    expect(parseCookies('a=1; dockly_session=abc.def; b=%20x')).toEqual({ a: '1', dockly_session: 'abc.def', b: ' x' })
  })
})

describe('file validation', () => {
  it('detects types by content, not extension', async () => {
    expect(detectKind(await samplePdf(1))).toBe('pdf')
    expect(detectKind(tinyPng)).toBe('png')
    expect(detectKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('jpg')
    expect(detectKind(Buffer.from('MZ\x90\x00 not a document'))).toBeNull()
    expect(detectKind(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2]), 'docx')).toBe('docx')
    expect(detectKind(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2]), 'zip')).toBeNull()
  })
  it('rejects disguised files and disallowed formats', async () => {
    const exe = Buffer.from('MZ fake executable content')
    expect(validateUpload({ buffer: exe, fileName: 'scan.pdf', allowedFormats: ['pdf'] })).toEqual({ ok: false, code: 'unsupported_file_type' })
    expect(validateUpload({ buffer: tinyPng, fileName: 'a.png', allowedFormats: ['pdf'] })).toEqual({ ok: false, code: 'file_type_not_allowed' })
    expect(validateUpload({ buffer: tinyPng, fileName: 'a.png', allowedFormats: ['jpg', 'png'] }).ok).toBe(true)
    expect(validateUpload({ buffer: await samplePdf(1), fileName: 'x.pdf', allowedFormats: ['pdf'], maxBytes: 10 })).toEqual({ ok: false, code: 'file_too_large' })
    expect(validateUpload({ buffer: Buffer.alloc(0), fileName: 'x.pdf' })).toEqual({ ok: false, code: 'empty_file' })
  })
  it('expands format aliases', () => {
    expect([...allowedExtensions(['jpg'])]).toEqual(['jpg', 'jpeg'])
  })
  it('cleans names and builds safe headers', () => {
    expect(cleanDisplayName('../../etc/passwd')).toBe('passwd')
    expect(cleanDisplayName('evil‮gnp.exe')).toBe('evilgnp.exe')
    expect(cleanDisplayName('')).toBe('document')
    expect(storageSlug('תעודת זהות.pdf')).toBe('file.pdf')
    expect(contentDisposition('תעודה "1".pdf')).toContain("filename*=UTF-8''%D7%AA")
    expect(contentDisposition('a"b.pdf')).toContain('filename="a_b.pdf"')
  })
})

describe('request status rules', () => {
  const d = (status, req = true) => ({ status, is_required: req })
  it('derives status from documents', () => {
    expect(computeRequestStatus('new', [d('missing')])).toBe('new')
    expect(computeRequestStatus('new', [d('missing')], { sent: true })).toBe('waiting-for-client')
    expect(computeRequestStatus('waiting-for-client', [d('uploaded'), d('missing')])).toBe('partial-submission')
    expect(computeRequestStatus('partial-submission', [d('uploaded'), d('approved')])).toBe('completed')
    expect(computeRequestStatus('completed', [d('rejected'), d('approved')])).toBe('partial-submission')
    expect(computeRequestStatus('closed', [d('missing')])).toBe('closed')
    // optional items don't block completion
    expect(computeRequestStatus('waiting-for-client', [d('approved'), d('missing', false)])).toBe('completed')
  })
  it('maps legacy statuses', () => {
    expect(canonicalDocStatus('received')).toBe('uploaded')
    expect(canonicalDocStatus('blurry')).toBe('rejected')
    expect(canonicalDocStatus('pending-upload')).toBe('missing')
  })
  it('summarizes progress against required items', () => {
    const s = summarizeDocuments([d('approved'), d('uploaded'), d('missing'), d('missing', false)])
    expect(s).toMatchObject({ required: 3, approved: 1, awaitingReview: 1, outstandingRequired: 1, percent: 67 })
  })
  it('allows only valid review transitions', () => {
    expect(reviewTransition('uploaded', 'approve')).toBe('approved')
    expect(reviewTransition('missing', 'approve')).toBeNull()
    expect(reviewTransition('approved', 'reject')).toBe('rejected')
    expect(reviewTransition('approved', 'reopen')).toBe('uploaded')
    expect(clientCanUpload('approved')).toBe(false)
    expect(clientCanUpload('rejected')).toBe(true)
  })
  it('flags overdue requests', () => {
    expect(isOverdue({ deadline: '2000-01-01', status: 'waiting-for-client' })).toBe(true)
    expect(isOverdue({ deadline: '2000-01-01', status: 'completed' })).toBe(false)
  })
})

describe('bidi text layout', () => {
  it('reverses Hebrew into visual order', () => {
    expect(isRtlText('שלום')).toBe(true)
    expect(visualRuns('שלום').map((r) => r.text).join('')).toBe('םולש')
  })
  it('keeps numbers and Latin left-to-right inside Hebrew', () => {
    const out = visualRuns('ת.ז 123456').map((r) => r.text).join('')
    expect(out).toBe('123456 ז.ת')
  })
  it('handles Hebrew inside an English sentence', () => {
    expect(visualRuns('Name: דנה לוי').map((r) => r.text).join('')).toBe('Name: יול הנד')
  })
  it('mirrors brackets in RTL runs', () => {
    expect(visualRuns('(שלום)').map((r) => r.text).join('')).toBe('(םולש)')
  })
  it('splits font segments by script', () => {
    expect(fontSegments('abcאב')).toEqual([{ hebrew: false, text: 'abc' }, { hebrew: true, text: 'אב' }])
  })
})

describe('pdf coordinate mapping', () => {
  it('maps displayed coordinates for each page rotation', () => {
    // A4 portrait user space: 595 x 842
    expect(viewToUser(0, 0, 0, 595, 842)).toEqual({ x: 0, y: 842 })
    expect(viewToUser(0, 0, 90, 595, 842)).toEqual({ x: 0, y: 0 })
    expect(viewToUser(0, 0, 180, 595, 842)).toEqual({ x: 595, y: 0 })
    expect(viewToUser(0, 0, 270, 595, 842)).toEqual({ x: 595, y: 842 })
  })
})

describe('zip', () => {
  it('computes standard CRC-32', () => {
    expect(crc32(Buffer.from('hello'))).toBe(0x3610a686)
  })
  it('builds a structurally valid archive with unique UTF-8 names', () => {
    const zip = buildZip([{ name: 'א.txt', data: Buffer.from('1') }, { name: 'א.txt', data: Buffer.from('2') }])
    expect(zip.readUInt32LE(0)).toBe(0x04034b50)
    expect(zip.readUInt32LE(zip.length - 22)).toBe(0x06054b50)
    expect(zip.readUInt16LE(zip.length - 12)).toBe(2)
    expect(zip.includes(Buffer.from('א (2).txt'))).toBe(true)
  })
})

describe('phone normalization', () => {
  it('normalizes Israeli and international formats', () => {
    expect(normalizePhone('050-123-4567')).toBe('972501234567')
    expect(normalizePhone('+972 50 123 4567')).toBe('972501234567')
    expect(normalizePhone('0044 20 7946 0958')).toBe('442079460958')
    expect(normalizePhone('12')).toBeNull()
    expect(normalizePhone('')).toBeNull()
  })
})

describe('automation quiet hours', () => {
  const s = { quietHours: { enabled: true, start: '20:00', end: '08:00' }, weekendDays: [5, 6] }
  it('respects overnight quiet windows in the workspace timezone', () => {
    // 2026-10-13 is a Tuesday. 19:30 UTC = 22:30 Jerusalem (UTC+3 in October).
    expect(isQuiet(s, new Date('2026-10-13T19:30:00Z'), 'Asia/Jerusalem')).toBe(true)
    expect(isQuiet(s, new Date('2026-10-13T09:00:00Z'), 'Asia/Jerusalem')).toBe(false)
  })
  it('skips weekend days', () => {
    expect(isQuiet(s, new Date('2026-10-16T09:00:00Z'), 'Asia/Jerusalem')).toBe(true) // Friday
  })
})
