import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useNavigate, useParams } from 'react-router-dom'
import { User, Building2, Palette, Users, Zap, Plug, Shield, Upload, Trash2, CheckCircle2, AlertTriangle, MessageCircle, Mail, Copy, UserPlus, XCircle, LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { useApp } from '@/contexts/AppContext'
import { useApi, invalidate } from '@/hooks/useApi'
import { authApi, workspaceApi } from '@/services'
import { ApiError } from '@/lib/api'
import { Card, CardHeader, CardBody } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input, Textarea, Select, Switch } from '@/components/ui/Field'
import { PageHeader, Avatar, CopyButton } from '@/components/ui/Misc'
import { Dialog, ConfirmDialog } from '@/components/ui/Dialog'
import { Badge } from '@/components/ui/Badge'
import { ErrorState, Skeleton } from '@/components/ui/States'
import { brandStyle } from '@/pages/portal/PublicShell'
import type { AutomationSettings, Role, Language } from '@/types'

const SECTIONS = [
  { id: 'profile', icon: User },
  { id: 'workspace', icon: Building2, admin: true },
  { id: 'branding', icon: Palette, admin: true },
  { id: 'team', icon: Users },
  { id: 'automation', icon: Zap },
  { id: 'integrations', icon: Plug },
  { id: 'security', icon: Shield },
] as const

function SaveBar({ dirty, busy, onSave, onReset }: { dirty: boolean; busy: boolean; onSave: () => void; onReset: () => void }) {
  const { t } = useI18n()
  return (
    <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">
      {dirty && <span className="me-auto text-xs text-fg-3">{t('settings.unsaved')}</span>}
      <Button onClick={onReset} disabled={!dirty || busy}>{t('common.cancel')}</Button>
      <Button variant="primary" onClick={onSave} loading={busy} disabled={!dirty}>{t('common.save')}</Button>
    </div>
  )
}

function ProfileSection() {
  const { t } = useI18n()
  const { user, setUser } = useAuth()
  const { toast, toastError } = useApp()
  const [f, setF] = useState({ name: user?.name || '', phone: user?.phone || '' })
  const [pw, setPw] = useState({ current: '', next: '' })
  const [busy, setBusy] = useState(false)
  const [pwBusy, setPwBusy] = useState(false)
  const [pwError, setPwError] = useState('')
  const dirty = f.name !== (user?.name || '') || f.phone !== (user?.phone || '')
  const save = async () => {
    setBusy(true)
    try { const me = await authApi.updateProfile(f); if (me.user) setUser(me.user); toast({ tone: 'success', title: t('common.saved') }) } catch (e) { toastError(e, t('settings.saveFailed')) } finally { setBusy(false) }
  }
  const changePw = async () => {
    setPwError('')
    if (pw.next.length < 8) { setPwError(t('auth.passwordHint')); return }
    setPwBusy(true)
    try { await authApi.changePassword(pw.current, pw.next); setPw({ current: '', next: '' }); toast({ tone: 'success', title: t('settings.passwordChanged') }) } catch (e) { setPwError(e instanceof ApiError ? e.message : t('common.error')) } finally { setPwBusy(false) }
  }
  return (
    <>
      <Card>
        <CardHeader title={t('settings.profile.title')} description={t('settings.profile.hint')} />
        <CardBody className="space-y-4">
          <div className="flex items-center gap-3"><Avatar name={f.name || user?.email || ''} size="lg" /><div><p className="font-medium">{user?.email}</p><Badge tone="brand">{t(`roles.${user?.role}`)}</Badge></div></div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label={t('auth.name')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
            <Input label={t('auth.phone')} value={f.phone} dir="ltr" onChange={(e) => setF({ ...f, phone: e.target.value })} />
          </div>
        </CardBody>
        <SaveBar dirty={dirty} busy={busy} onSave={save} onReset={() => setF({ name: user?.name || '', phone: user?.phone || '' })} />
      </Card>
      <Card>
        <CardHeader title={t('settings.password.title')} description={t('settings.password.hint')} />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Input label={t('settings.password.current')} type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
          <Input label={t('settings.password.new')} type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} hint={t('auth.passwordHint')} error={pwError} />
          <div className="sm:col-span-2"><Button onClick={changePw} loading={pwBusy} disabled={!pw.current || !pw.next}>{t('settings.password.change')}</Button></div>
        </CardBody>
      </Card>
    </>
  )
}

function WorkspaceSection() {
  const { t } = useI18n()
  const { workspace, setWorkspace } = useAuth()
  const { toast, toastError } = useApp()
  const init = () => ({ name: workspace?.name || '', phone: workspace?.phone || '', email: workspace?.email || '', defaultLanguage: (workspace?.defaultLanguage || 'he') as Language, timezone: workspace?.timezone || 'Asia/Jerusalem' })
  const [f, setF] = useState(init)
  const [busy, setBusy] = useState(false)
  const dirty = JSON.stringify(f) !== JSON.stringify(init())
  const zones = ['Asia/Jerusalem', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Los_Angeles', 'UTC']
  const save = async () => {
    setBusy(true)
    try { setWorkspace(await workspaceApi.update(f)); toast({ tone: 'success', title: t('common.saved') }) } catch (e) { toastError(e, t('settings.saveFailed')) } finally { setBusy(false) }
  }
  return (
    <Card>
      <CardHeader title={t('settings.workspace.title')} description={t('settings.workspace.hint')} />
      <CardBody className="space-y-4">
        <Input label={t('onboarding.businessName')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label={t('onboarding.phone')} dir="ltr" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} hint={t('onboarding.contactHint')} />
          <Input label={t('onboarding.email')} dir="ltr" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <Select label={t('onboarding.clientLanguage')} value={f.defaultLanguage} onChange={(e) => setF({ ...f, defaultLanguage: e.target.value as Language })} options={[{ value: 'he', label: 'עברית' }, { value: 'en', label: 'English' }]} />
          <Select label={t('settings.workspace.timezone')} value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} options={(zones.includes(f.timezone) ? zones : [f.timezone, ...zones]).map((z) => ({ value: z, label: z }))} hint={t('settings.workspace.timezoneHint')} />
        </div>
      </CardBody>
      <SaveBar dirty={dirty} busy={busy} onSave={save} onReset={() => setF(init())} />
    </Card>
  )
}

const SWATCHES = ['#4B4ACF', '#2563EB', '#0E7490', '#047857', '#B45309', '#BE123C', '#7C3AED', '#111827']

function BrandingSection() {
  const { t } = useI18n()
  const { workspace, setWorkspace } = useAuth()
  const { toast, toastError } = useApp()
  const [color, setColor] = useState(workspace?.brandColor || '#4B4ACF')
  const [message, setMessage] = useState(workspace?.portalMessage || '')
  const [busy, setBusy] = useState(false)
  const [logoBusy, setLogoBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)
  const dirty = color !== (workspace?.brandColor || '#4B4ACF') || message !== (workspace?.portalMessage || '')
  const save = async () => {
    setBusy(true)
    try { setWorkspace(await workspaceApi.update({ brandColor: color, portalMessage: message })); toast({ tone: 'success', title: t('common.saved') }) } catch (e) { toastError(e, t('settings.saveFailed')) } finally { setBusy(false) }
  }
  const uploadLogo = async (f: File) => {
    setLogoBusy(true)
    try { setWorkspace(await workspaceApi.uploadLogo(f)); toast({ tone: 'success', title: t('settings.branding.logoSaved') }) } catch (e) { toastError(e, t('settings.branding.logoFailed')) } finally { setLogoBusy(false) }
  }
  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
      <Card>
        <CardHeader title={t('settings.branding.title')} description={t('settings.branding.hint')} />
        <CardBody className="space-y-6">
          <div>
            <p className="mb-2 text-sm font-medium text-fg-2">{t('settings.branding.logo')}</p>
            <div className="flex items-center gap-4">
              <div className="flex size-16 items-center justify-center overflow-hidden rounded-xl border border-line bg-white">
                {workspace?.logo ? <img src={workspace.logo} alt="" className="size-full object-contain" /> : <Building2 className="size-6 text-slate-400" />}
              </div>
              <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) uploadLogo(f) }} />
              <Button icon={<Upload className="size-4" />} loading={logoBusy} onClick={() => file.current?.click()}>{t('settings.branding.uploadLogo')}</Button>
              {workspace?.logo && <Button variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => workspaceApi.update({ logoUrl: null }).then(setWorkspace).catch((e) => toastError(e, t('common.error')))}>{t('common.remove')}</Button>}
            </div>
            <p className="mt-2 text-xs text-fg-3">{t('settings.branding.logoHint')}</p>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-fg-2">{t('settings.branding.color')}</p>
            <div className="flex flex-wrap items-center gap-2">
              {SWATCHES.map((s) => (
                <button key={s} type="button" onClick={() => setColor(s)} aria-label={s} aria-pressed={color.toLowerCase() === s.toLowerCase()} className={cn('size-8 rounded-full border-2', color.toLowerCase() === s.toLowerCase() ? 'border-fg ring-2 ring-offset-2 ring-offset-surface ring-line-2' : 'border-transparent')} style={{ background: s }} />
              ))}
              <label className="ms-2 flex items-center gap-2 text-sm text-fg-3">
                <input type="color" value={color} onChange={(e) => setColor(e.target.value.toUpperCase())} className="size-8 cursor-pointer rounded border border-line bg-transparent" aria-label={t('settings.branding.custom')} />
                <span className="font-mono text-xs" dir="ltr">{color}</span>
              </label>
            </div>
          </div>
          <Textarea label={t('settings.branding.message')} value={message} onChange={(e) => setMessage(e.target.value)} rows={3} maxLength={1000} hint={t('settings.branding.messageHint')} />
        </CardBody>
        <SaveBar dirty={dirty} busy={busy} onSave={save} onReset={() => { setColor(workspace?.brandColor || '#4B4ACF'); setMessage(workspace?.portalMessage || '') }} />
      </Card>
      <div>
        <p className="mb-2 text-sm font-medium text-fg-3">{t('settings.branding.preview')}</p>
        <div className="overflow-hidden rounded-2xl border border-line bg-canvas shadow-sm" style={brandStyle(color)}>
          <div className="h-1 bg-brand-600" />
          <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2.5">
            {workspace?.logo ? <img src={workspace.logo} alt="" className="size-7 rounded-md object-contain" /> : <span className="flex size-7 items-center justify-center rounded-md bg-brand-600 text-xs font-semibold text-brand-fg">{workspace?.name.slice(0, 1)}</span>}
            <span className="truncate text-sm font-semibold">{workspace?.name}</span>
          </div>
          <div className="space-y-3 p-3">
            <p className="text-sm font-semibold">{t('portal.greeting', { name: t('settings.branding.sampleName') })}</p>
            {message && <p className="whitespace-pre-wrap text-xs text-fg-3">{message}</p>}
            <div className="rounded-lg border border-line bg-surface p-3">
              <p className="text-xs font-medium">{t('settings.branding.sampleDoc')}</p>
              <span className="mt-2 inline-flex h-8 items-center rounded-md bg-brand-600 px-3 text-xs font-semibold text-brand-fg">{t('portal.upload')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function TeamSection() {
  const { t, fmt } = useI18n()
  const { can, user } = useAuth()
  const { toast, toastError } = useApp()
  const { data, error, loading, refetch } = useApi('team', workspaceApi.team)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [inv, setInv] = useState({ email: '', name: '', role: 'member' as Exclude<Role, 'owner'> })
  const [link, setLink] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null)
  const admin = can('admin')
  const roles: Role[] = user?.role === 'owner' ? ['owner', 'admin', 'member', 'viewer'] : ['admin', 'member', 'viewer']
  const invite = async () => {
    setBusy(true)
    try {
      const r = await workspaceApi.invite(inv)
      setLink(r.link)
      refetch()
      toast({ tone: 'success', title: r.emailed ? t('settings.team.invitedEmailed') : t('settings.team.invitedLink') })
    } catch (e) { toastError(e, t('settings.team.inviteFailed')) } finally { setBusy(false) }
  }
  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader title={t('settings.team.title')} description={t('settings.team.hint')} action={admin && <Button variant="primary" size="sm" icon={<UserPlus className="size-4" />} onClick={() => { setInv({ email: '', name: '', role: 'member' }); setLink(null); setInviteOpen(true) }}>{t('settings.team.invite')}</Button>} />
        {error ? <ErrorState onRetry={refetch} /> : loading || !data ? <CardBody><Skeleton className="h-32" /></CardBody> : (
          <ul className="divide-y divide-line border-t border-line">
            {data.members.map((m) => (
              <li key={m.id} className={cn('flex flex-wrap items-center gap-3 px-5 py-3', !m.isActive && 'opacity-50')}>
                <Avatar name={m.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{m.name}{m.isYou && <span className="ms-1.5 text-xs text-fg-4">({t('common.you')})</span>}</p>
                  <p className="truncate text-xs text-fg-3">{m.email}{m.lastLoginAt ? ` · ${t('settings.team.lastSeen', { date: fmt.relative(m.lastLoginAt) })}` : ''}</p>
                </div>
                {!m.isActive ? <Badge>{t('settings.team.removed')}</Badge> : admin && !m.isYou ? (
                  <>
                    <Select selectSize="sm" aria-label={t('settings.team.role')} value={m.role} wrapperClassName="w-36" disabled={m.role === 'owner' && user?.role !== 'owner'}
                      onChange={(e) => workspaceApi.setRole(m.id, e.target.value as Role).then(() => { refetch(); toast({ tone: 'success', title: t('settings.team.roleChanged') }) }).catch((err) => toastError(err, t('common.error')))}
                      options={(roles.includes(m.role) ? roles : [m.role, ...roles]).map((r) => ({ value: r, label: t(`roles.${r}`) }))} />
                    <Button size="sm" variant="ghost" className="text-danger-fg" onClick={() => setRemoving({ id: m.id, name: m.name })}>{t('common.remove')}</Button>
                  </>
                ) : <Badge tone="brand">{t(`roles.${m.role}`)}</Badge>}
              </li>
            ))}
            {data.invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <span className="flex size-8 items-center justify-center rounded-full border border-dashed border-line-2 text-fg-4"><Mail className="size-4" /></span>
                <div className="min-w-0 flex-1"><p className="truncate text-sm">{i.email}</p><p className="text-xs text-fg-3">{t('settings.team.pending', { role: t(`roles.${i.role}`), date: fmt.date(i.expiresAt) })}</p></div>
                {admin && <Button size="sm" variant="ghost" icon={<XCircle className="size-4" />} onClick={() => workspaceApi.revokeInvite(i.id).then(refetch).catch((e) => toastError(e, t('common.error')))}>{t('settings.team.revoke')}</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title={t('settings.team.rolesTitle')} />
        <CardBody>
          <dl className="grid gap-3 sm:grid-cols-2">
            {(['owner', 'admin', 'member', 'viewer'] as Role[]).map((r) => (
              <div key={r} className="rounded-lg border border-line p-3"><dt className="text-sm font-medium">{t(`roles.${r}`)}</dt><dd className="mt-0.5 text-xs text-fg-3">{t(`settings.team.roleHelp.${r}`)}</dd></div>
            ))}
          </dl>
        </CardBody>
      </Card>
      <Dialog open={inviteOpen} onClose={() => setInviteOpen(false)} title={t('settings.team.invite')} description={t('settings.team.inviteHint')}
        footer={link ? <Button variant="primary" onClick={() => setInviteOpen(false)}>{t('common.done')}</Button> : <><Button onClick={() => setInviteOpen(false)}>{t('common.cancel')}</Button><Button variant="primary" loading={busy} onClick={invite} disabled={!/\S+@\S+\.\S+/.test(inv.email)}>{t('settings.team.sendInvite')}</Button></>}>
        {link ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-success-fg"><CheckCircle2 className="size-4" />{t('settings.team.linkReady')}</p>
            <div className="flex items-center gap-2 rounded-md border border-line bg-surface-2 px-3 py-2"><span className="min-w-0 flex-1 truncate font-mono text-xs" dir="ltr">{link}</span><CopyButton value={link} /></div>
            <p className="text-xs text-fg-3">{t('settings.team.linkOnce')}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <Input label={t('auth.email')} type="email" dir="ltr" value={inv.email} onChange={(e) => setInv({ ...inv, email: e.target.value })} autoFocus required />
            <Input label={t('auth.name')} value={inv.name} onChange={(e) => setInv({ ...inv, name: e.target.value })} optionalLabel={t('common.optional')} />
            <Select label={t('settings.team.role')} value={inv.role} onChange={(e) => setInv({ ...inv, role: e.target.value as Exclude<Role, 'owner'> })} options={(['admin', 'member', 'viewer'] as const).map((r) => ({ value: r, label: t(`roles.${r}`) }))} hint={t(`settings.team.roleHelp.${inv.role}`)} />
          </div>
        )}
      </Dialog>
      <ConfirmDialog open={Boolean(removing)} onClose={() => setRemoving(null)} title={t('settings.team.removeTitle', { name: removing?.name || '' })} description={t('settings.team.removeHint')} confirmLabel={t('common.remove')}
        onConfirm={async () => { try { await workspaceApi.removeMember(removing!.id); refetch() } catch (e) { toastError(e, t('common.error')); throw e } }} />
    </>
  )
}

function NumberField({ label, value, onChange, min = 1, max = 60, suffix }: { label: string; value: number; onChange: (n: number) => void; min?: number; max?: number; suffix?: string }) {
  return (
    <Input inputSize="sm" type="number" label={label} min={min} max={max} value={value} onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || min)))}
      trailing={suffix ? <span className="pe-1 text-xs text-fg-4">{suffix}</span> : undefined} />
  )
}

function AutomationSection() {
  const { t } = useI18n()
  const { can } = useAuth()
  const { toast, toastError } = useApp()
  const { data, error, loading, refetch } = useApi('automation', workspaceApi.automation)
  const [s, setS] = useState<AutomationSettings | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (data) setS(data.settings) }, [data])
  if (error) return <Card><ErrorState onRetry={refetch} /></Card>
  if (loading || !s || !data) return <Skeleton className="h-96 rounded-xl" />
  const admin = can('admin')
  const dirty = JSON.stringify(s) !== JSON.stringify(data.settings)
  const set = <K extends keyof AutomationSettings>(k: K, v: AutomationSettings[K]) => setS({ ...s, [k]: v })
  const save = async () => {
    setBusy(true)
    try { await workspaceApi.saveAutomation(s); invalidate('automation'); toast({ tone: 'success', title: t('common.saved') }) } catch (e) { toastError(e, t('settings.saveFailed')) } finally { setBusy(false) }
  }
  const days = t('settings.automation.daysUnit')
  const waOk = data.channels.whatsapp.configured
  const emailOk = data.channels.email.configured
  const channelWarn = (c: 'whatsapp' | 'email') => (c === 'whatsapp' ? !waOk : !emailOk)
  const weekdayNames = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(t('settings.automation.locale'), { weekday: 'short' }).format(new Date(2026, 0, 4 + i)))
  return (
    <Card>
      <CardHeader title={t('settings.automation.title')} description={t('settings.automation.hint')} />
      <CardBody className="space-y-6">
        {!data.schedulerEnabled && <p className="flex items-start gap-2 rounded-lg bg-warning-soft p-3 text-sm text-warning-fg"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{t('settings.automation.schedulerOff')}</p>}
        <fieldset disabled={!admin} className="space-y-6">
          <section className="space-y-3">
            <Switch checked={s.requestReminders.enabled} onChange={(v) => set('requestReminders', { ...s.requestReminders, enabled: v })} label={t('settings.automation.requestReminders')} description={t('settings.automation.requestRemindersHint')} />
            {s.requestReminders.enabled && (
              <div className="grid gap-3 rounded-lg border border-line bg-surface-2 p-3 sm:grid-cols-4">
                <NumberField label={t('settings.automation.firstAfter')} value={s.requestReminders.firstAfterDays} suffix={days} onChange={(n) => set('requestReminders', { ...s.requestReminders, firstAfterDays: n })} />
                <NumberField label={t('settings.automation.repeatEvery')} value={s.requestReminders.repeatEveryDays} suffix={days} onChange={(n) => set('requestReminders', { ...s.requestReminders, repeatEveryDays: n })} />
                <NumberField label={t('settings.automation.max')} value={s.requestReminders.maxReminders} max={10} onChange={(n) => set('requestReminders', { ...s.requestReminders, maxReminders: n })} />
                <Select selectSize="sm" label={t('settings.automation.channel')} value={s.requestReminders.channel} onChange={(e) => set('requestReminders', { ...s.requestReminders, channel: e.target.value as 'whatsapp' | 'email' })} options={[{ value: 'whatsapp', label: 'WhatsApp' }, { value: 'email', label: t('requests.create.channel.email') }]} />
                {channelWarn(s.requestReminders.channel) && <p className="text-xs text-warning-fg sm:col-span-4">{t('settings.automation.channelOff')}</p>}
              </div>
            )}
          </section>
          <section className="space-y-3 border-t border-line pt-5">
            <Switch checked={s.deadlineReminder.enabled} onChange={(v) => set('deadlineReminder', { ...s.deadlineReminder, enabled: v })} label={t('settings.automation.deadline')} description={t('settings.automation.deadlineHint')} />
            {s.deadlineReminder.enabled && <div className="max-w-[200px]"><NumberField label={t('settings.automation.daysBefore')} value={s.deadlineReminder.daysBefore} max={30} suffix={days} onChange={(n) => set('deadlineReminder', { daysBefore: n, enabled: true })} /></div>}
          </section>
          <section className="space-y-3 border-t border-line pt-5">
            <Switch checked={s.signatureReminders.enabled} onChange={(v) => set('signatureReminders', { ...s.signatureReminders, enabled: v })} label={t('settings.automation.signatureReminders')} description={t('settings.automation.signatureRemindersHint')} />
            {s.signatureReminders.enabled && (
              <div className="grid gap-3 rounded-lg border border-line bg-surface-2 p-3 sm:grid-cols-3">
                <NumberField label={t('settings.automation.firstAfter')} value={s.signatureReminders.firstAfterDays} suffix={days} onChange={(n) => set('signatureReminders', { ...s.signatureReminders, firstAfterDays: n })} />
                <NumberField label={t('settings.automation.repeatEvery')} value={s.signatureReminders.repeatEveryDays} suffix={days} onChange={(n) => set('signatureReminders', { ...s.signatureReminders, repeatEveryDays: n })} />
                <NumberField label={t('settings.automation.max')} value={s.signatureReminders.maxReminders} max={10} onChange={(n) => set('signatureReminders', { ...s.signatureReminders, maxReminders: n })} />
                {!emailOk && <p className="text-xs text-warning-fg sm:col-span-3">{t('settings.automation.signatureEmailOnly')}</p>}
              </div>
            )}
          </section>
          <section className="space-y-3 border-t border-line pt-5">
            <Switch checked={s.quietHours.enabled} onChange={(v) => set('quietHours', { ...s.quietHours, enabled: v })} label={t('settings.automation.quiet')} description={t('settings.automation.quietHint')} />
            {s.quietHours.enabled && (
              <div className="flex max-w-xs gap-3">
                <Input inputSize="sm" type="time" label={t('settings.automation.from')} value={s.quietHours.start} onChange={(e) => set('quietHours', { ...s.quietHours, start: e.target.value })} />
                <Input inputSize="sm" type="time" label={t('settings.automation.until')} value={s.quietHours.end} onChange={(e) => set('quietHours', { ...s.quietHours, end: e.target.value })} />
              </div>
            )}
            <div>
              <p className="mb-2 text-sm font-medium text-fg-2">{t('settings.automation.noSendDays')}</p>
              <div className="flex flex-wrap gap-1.5">
                {weekdayNames.map((n, i) => {
                  const on = s.weekendDays.includes(i)
                  return <button key={i} type="button" aria-pressed={on} onClick={() => set('weekendDays', on ? s.weekendDays.filter((d) => d !== i) : [...s.weekendDays, i])} className={cn('h-8 min-w-12 rounded-md border px-2 text-xs', on ? 'border-brand-500 bg-brand-soft font-medium text-brand-700' : 'border-line text-fg-3')}>{n}</button>
                })}
              </div>
            </div>
          </section>
        </fieldset>
        {!admin && <p className="text-xs text-fg-4">{t('settings.adminOnly')}</p>}
      </CardBody>
      {admin && <SaveBar dirty={dirty} busy={busy} onSave={save} onReset={() => setS(data.settings)} />}
    </Card>
  )
}

function StatusRow({ icon, title, ok, okText, offText, children }: { icon: ReactNode; title: string; ok: boolean; okText: string; offText: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-fg-2">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2"><p className="font-medium">{title}</p>{ok ? <Badge tone="success" dot>{okText}</Badge> : <Badge tone="warning" dot>{offText}</Badge>}</div>
        <div className="mt-1 space-y-1 text-sm text-fg-3">{children}</div>
      </div>
    </div>
  )
}

function IntegrationsSection() {
  const { t } = useI18n()
  const { data, error, loading, refetch } = useApi('integrations', workspaceApi.integrations)
  if (error) return <Card><ErrorState onRetry={refetch} /></Card>
  if (loading || !data) return <Skeleton className="h-64 rounded-xl" />
  const webhook = `${window.location.origin}/api/whatsapp/webhook`
  return (
    <Card className="overflow-hidden">
      <CardHeader title={t('settings.integrations.title')} description={t('settings.integrations.hint')} />
      <div className="divide-y divide-line border-t border-line">
        <StatusRow icon={<MessageCircle className="size-5" />} title="WhatsApp Business (Cloud API)" ok={data.whatsapp.configured} okText={t('settings.integrations.connected')} offText={data.whatsapp.mode === 'log' ? t('settings.integrations.simulation') : t('settings.integrations.notConnected')}>
          <p>{data.whatsapp.configured ? t('settings.integrations.waConnected') : t('settings.integrations.waOff')}</p>
          {data.whatsapp.configured && !data.whatsapp.webhookVerified && <p className="flex items-center gap-1.5 text-warning-fg"><AlertTriangle className="size-4" />{t('settings.integrations.waNoSecret')}</p>}
          <div className="flex items-center gap-2 pt-1"><span className="text-xs">{t('settings.integrations.webhookUrl')}</span><code className="truncate rounded bg-surface-3 px-1.5 py-0.5 text-xs" dir="ltr">{webhook}</code><CopyButton value={webhook} /></div>
        </StatusRow>
        <StatusRow icon={<Mail className="size-5" />} title={t('settings.integrations.email')} ok={data.email.configured} okText={t('settings.integrations.connected')} offText={t('settings.integrations.notConnected')}>
          <p>{data.email.configured ? t('settings.integrations.emailOn') : t('settings.integrations.emailOff')}</p>
        </StatusRow>
      </div>
    </Card>
  )
}

function SecuritySection() {
  const { t } = useI18n()
  const { toastError } = useApp()
  const navigate = useNavigate()
  const [confirm, setConfirm] = useState(false)
  return (
    <>
      <Card>
        <CardHeader title={t('settings.security.title')} description={t('settings.security.hint')} />
        <CardBody className="space-y-3 text-sm text-fg-2">
          <p className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />{t('settings.security.point1')}</p>
          <p className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />{t('settings.security.point2')}</p>
          <p className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />{t('settings.security.point3')}</p>
          <p className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />{t('settings.security.point4')}</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={t('settings.security.sessions')} description={t('settings.security.sessionsHint')} action={<Button icon={<LogOut className="size-4" />} onClick={() => setConfirm(true)}>{t('settings.security.signOutAll')}</Button>} />
      </Card>
      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} tone="primary" title={t('settings.security.signOutAllTitle')} description={t('settings.security.signOutAllHint')} confirmLabel={t('settings.security.signOutAll')}
        onConfirm={async () => { try { await authApi.signOutAll(); window.location.assign('/auth/signin') } catch (e) { toastError(e, t('common.error')); throw e } }} />
      <span hidden>{String(navigate === null)}</span>
    </>
  )
}

export default function SettingsPage() {
  const { section = 'profile' } = useParams()
  const { t } = useI18n()
  const { can } = useAuth()
  const visible = SECTIONS.filter((s) => !('admin' in s) || can('admin'))
  const current = visible.find((s) => s.id === section)?.id || 'profile'
  const content: Record<string, ReactNode> = {
    profile: <ProfileSection />, workspace: <WorkspaceSection />, branding: <BrandingSection />, team: <TeamSection />,
    automation: <AutomationSection />, integrations: <IntegrationsSection />, security: <SecuritySection />,
  }
  return (
    <>
      <PageHeader title={t('nav.settings')} description={t('settings.subtitle')} />
      <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
        <nav aria-label={t('nav.settings')} className="flex gap-1 overflow-x-auto lg:flex-col">
          {visible.map((s) => (
            <NavLink key={s.id} to={`/app/settings/${s.id}`} className={() => cn('flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium', current === s.id ? 'bg-surface text-fg shadow-xs ring-1 ring-line' : 'text-fg-3 hover:bg-surface-3 hover:text-fg-2')}>
              <s.icon className="size-4" />{t(`settings.nav.${s.id}`)}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0 space-y-6">{content[current]}</div>
      </div>
      <span hidden><Copy /></span>
    </>
  )
}
