import { useEffect, useState } from 'react'
import { Download, ExternalLink, FileText } from 'lucide-react'
import { fileKind } from '@/lib/utils'
import { useI18n } from '@/contexts/I18nContext'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Spinner, ErrorState } from '@/components/ui/States'

interface FilePreviewProps {
  open: boolean
  onClose: () => void
  title: string
  fileName?: string
  mimeType?: string
  /** Fetches a fresh short-lived URL (inline) */
  getUrl: () => Promise<{ url: string }>
  /** Fetches a download URL (attachment) */
  getDownloadUrl?: () => Promise<{ url: string }>
  footer?: React.ReactNode
}

/** In-app preview for images and PDFs using short-lived URLs. */
export function FilePreview({ open, onClose, title, fileName, mimeType, getUrl, getDownloadUrl, footer }: FilePreviewProps) {
  const { t } = useI18n()
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const kind = fileKind(mimeType, fileName)

  useEffect(() => {
    if (!open) { setUrl(null); setFailed(false); return }
    let alive = true
    getUrl().then((r) => alive && setUrl(r.url)).catch(() => alive && setFailed(true))
    return () => { alive = false }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const download = async () => {
    const r = await (getDownloadUrl || getUrl)()
    const a = document.createElement('a')
    a.href = r.url
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={fileName}
      size="xl"
      bodyClassName="p-0 bg-surface-3"
      footer={
        <>
          {footer}
          <div className="ms-auto flex gap-2">
            {url && <Button size="sm" icon={<ExternalLink className="size-4" />} onClick={() => window.open(url, '_blank', 'noopener')}>{t('common.open')}</Button>}
            <Button size="sm" variant="primary" icon={<Download className="size-4" />} onClick={download}>{t('common.download')}</Button>
          </div>
        </>
      }
    >
      <div className="flex min-h-[50vh] items-center justify-center">
        {failed ? <ErrorState /> : !url ? <Spinner className="size-6" /> : kind === 'image' ? (
          <img src={url} alt={title} className="max-h-[70vh] max-w-full object-contain" />
        ) : kind === 'pdf' ? (
          <iframe src={url} title={title} className="h-[70vh] w-full bg-white" />
        ) : (
          <div className="flex flex-col items-center gap-3 p-10 text-center text-fg-3">
            <FileText className="size-10" />
            <p className="text-sm">{t('requests.detail.noPreview')}</p>
          </div>
        )}
      </div>
    </Dialog>
  )
}
