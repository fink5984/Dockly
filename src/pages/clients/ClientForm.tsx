import { useEffect, useState } from 'react'
import { useI18n } from '@/contexts/I18nContext'
import { useApp } from '@/contexts/AppContext'
import { clientsApi } from '@/services'
import { ApiError } from '@/lib/api'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Input, Textarea } from '@/components/ui/Field'
import type { Client } from '@/types'

/** Loose client-side phone check; the server normalizes and validates for WhatsApp. */
export function phoneLooksValid(v: string) {
  const d = v.replace(/\D/g, '')
  return d.length === 0 || (d.length >= 9 && d.length <= 15)
}

export function ClientFormDialog({ open, onClose, client, onSaved }: { open: boolean; onClose: () => void; client?: Client; onSaved: (c: Client) => void }) {
  const { t } = useI18n()
  const { toastError } = useApp()
  const [f, setF] = useState({ name: '', phone: '', email: '', company: '', notes: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setF({ name: client?.name || '', phone: client?.phone || '', email: client?.email || '', company: client?.company || '', notes: client?.notes || '' })
      setErrors({})
    }
  }, [open, client])

  const save = async (e?: React.FormEvent) => {
    e?.preventDefault()
    const errs: Record<string, string> = {}
    if (!f.name.trim()) errs.name = t('clients.nameRequired')
    if (!phoneLooksValid(f.phone)) errs.phone = t('clients.phoneInvalidHint')
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) errs.email = t('onboarding.invalidEmail')
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      const body = { name: f.name.trim(), phone: f.phone.trim(), email: f.email.trim(), company: f.company.trim() || null, notes: f.notes || null }
      const saved = client ? await clientsApi.update(client.id, body) : await clientsApi.create(body)
      onSaved(saved)
      onClose()
    } catch (err) {
      if (err instanceof ApiError && err.code === 'validation_failed') setErrors(err.fields)
      else toastError(err, t('clients.saveFailed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={client ? t('clients.editTitle') : t('clients.newTitle')}
      description={client ? undefined : t('clients.newHint')}
      footer={<><Button onClick={onClose}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} onClick={() => save()}>{client ? t('common.save') : t('clients.create')}</Button></>}
    >
      <form onSubmit={save} className="space-y-4" noValidate>
        <Input label={t('clients.name')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={errors.name} required autoFocus />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={t('clients.phone')} type="tel" dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} error={errors.phone} hint={t('clients.phoneHint')} />
          <Input label={t('clients.email')} type="email" dir="ltr" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} error={errors.email} optionalLabel={t('common.optional')} />
        </div>
        <Input label={t('clients.company')} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} optionalLabel={t('common.optional')} />
        <Textarea label={t('clients.notes')} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} rows={3} hint={t('clients.notesHint')} optionalLabel={t('common.optional')} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  )
}
