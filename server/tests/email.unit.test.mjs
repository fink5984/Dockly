import { describe, it, expect } from 'vitest'
import { renderEmail } from '../messaging/email.mjs'
import { buildRequestEmail } from '../messaging/index.mjs'

const c = { ws_name: 'Pinktech', title: 'Mortgage', client_name: 'David', brand_color: '#0F7B5F' }
const url = 'https://sadir.app/p/token123'

describe('request emails', () => {
  it('uses singular Hebrew for one missing document and lists it', () => {
    const e = buildRequestEmail({ c, kind: 'request_reminder', lang: 'he', url, docs: [
      { name: 'Payslip', status: 'approved', is_required: true },
      { name: 'Bank statement', status: 'missing', is_required: true },
    ] })
    expect(e.subject).toContain('חסר עוד מסמך אחד')
    expect(e.html).not.toContain('1 מסמכים')
    expect(e.html).toContain('Bank statement')
    expect(e.html).toContain('התקבלו 1 מתוך 2 מסמכים')
    expect(e.text).toContain(url)
  })

  it('lists rejected documents with their reason in a rejection notice', () => {
    const e = buildRequestEmail({ c, kind: 'document_rejected', lang: 'en', url, docs: [
      { name: 'Contract', status: 'rejected', is_required: true, rejection_reason: 'Signature page missing' },
      { name: 'ID', status: 'missing', is_required: true },
    ] })
    expect(e.html).toContain('Not accepted: Signature page missing')
    expect(e.html).not.toContain('>ID<')
  })
})

describe('renderEmail', () => {
  it('escapes user content, including inside bold markers', () => {
    const { html } = renderEmail({ language: 'he', brandName: '<b>x</b>', heading: 'h', paragraphs: ['**<script>alert(1)</script>**'], ctaLabel: 'go', ctaUrl: 'https://a.b/"onmouseover' })
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<b>x</b>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('"onmouseover')
  })

  it('falls back to the brand colour when the workspace colour is not a hex value', () => {
    const { html } = renderEmail({ heading: 'h', brandColor: 'red;background:url(x)' })
    expect(html).not.toContain('url(x)')
  })
})
