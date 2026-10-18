import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Fingerprint } from 'lucide-react'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { useApp } from '@/contexts/AppContext'
import type { Me } from '@/services'
import { passkeysSupported, isPasskeyCancel, isPasskeyDuplicate, shouldOfferPasskey, registerPasskey, markPasskeyOnDevice, snoozePasskeyOffer, passkeyErrorDetail, reportPasskeyError } from '@/lib/passkeys'
import { AuthShell, PasswordInput } from './AuthShell'

export default function SignInPage() {
  const { t } = useI18n()
  const { signIn, enter, signInWithPasskey } = useAuth()
  const { toast } = useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  // Technical reason for an unexpected passkey failure (shown small, for support screenshots).
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(false)
  const [passkeyBusy, setPasskeyBusy] = useState(false)
  // Signed in, but holding at the "turn on fingerprint sign-in?" offer before entering the app.
  const [offer, setOffer] = useState<Me | null>(null)

  const goOn = () => {
    const from = (location.state as { from?: string } | null)?.from
    navigate(from && from.startsWith('/') && !from.startsWith('//') ? from : '/app', { replace: true })
  }

  const passkey = async () => {
    setError('')
    setDetail('')
    setPasskeyBusy(true)
    try {
      await signInWithPasskey()
      goOn()
    } catch (err) {
      if (isPasskeyCancel(err)) return
      const code = err instanceof ApiError ? err.code : ''
      if (code === 'passkey_unknown' || code === 'rate_limited') { setError(t(code === 'passkey_unknown' ? 'auth.passkeyUnknown' : 'auth.locked')); return }
      setError(t('auth.passkeyFailed'))
      setDetail(passkeyErrorDetail(err))
      reportPasskeyError('signin', err)
    } finally {
      setPasskeyBusy(false)
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setDetail('')
    setBusy(true)
    try {
      const me = await signIn(email.trim(), password, { defer: true })
      if (me.user && await shouldOfferPasskey(me.user.id)) { setOffer(me); return }
      enter(me)
      goOn()
    } catch (err) {
      const code = err instanceof ApiError ? err.code : ''
      setError(code === 'account_locked' || code === 'rate_limited' ? t('auth.locked') : code === 'invalid_credentials' ? t('auth.invalidCredentials') : t('common.loadFailedHint'))
    } finally {
      setBusy(false)
    }
  }

  const finishOffer = (me: Me) => {
    setPassword('')
    enter(me)
    goOn()
  }

  // The password was just verified, so it confirms adding the passkey without asking again.
  const enablePasskey = async () => {
    if (!offer?.user) return
    setError('')
    setDetail('')
    setPasskeyBusy(true)
    try {
      await registerPasskey(password)
      markPasskeyOnDevice(offer.user.id)
      toast({ tone: 'success', title: t('auth.offer.enabled') })
      finishOffer(offer)
    } catch (err) {
      if (isPasskeyCancel(err)) return
      const code = err instanceof ApiError ? err.code : ''
      if (code === 'passkey_exists' || isPasskeyDuplicate(err)) { markPasskeyOnDevice(offer.user.id); finishOffer(offer); return }
      setError(t('auth.offer.failed'))
      setDetail(passkeyErrorDetail(err))
      reportPasskeyError('register', err)
    } finally {
      setPasskeyBusy(false)
    }
  }

  const skipPasskey = () => {
    if (offer?.user) snoozePasskeyOffer(offer.user.id)
    if (offer) finishOffer(offer)
  }

  if (offer) {
    return (
      <AuthShell title={t('auth.offer.title')} subtitle={t('auth.offer.body')}>
        <div className="space-y-4">
          <div className="flex justify-center py-2" aria-hidden>
            <span className="flex size-20 items-center justify-center rounded-full bg-brand-soft text-brand-600"><Fingerprint className="size-10" /></span>
          </div>
          {error && <div role="alert" className="rounded-md border border-danger/20 bg-danger-soft px-3 py-2.5 text-sm text-danger-fg">{error}{detail && <p dir="ltr" className="mt-1.5 break-all font-mono text-[11px] text-fg-4">{detail}</p>}</div>}
          <Button variant="primary" size="lg" fullWidth icon={<Fingerprint className="size-5" />} loading={passkeyBusy} onClick={enablePasskey} autoFocus>{t('auth.offer.enable')}</Button>
          <Button variant="ghost" size="lg" fullWidth disabled={passkeyBusy} onClick={skipPasskey}>{t('auth.offer.notNow')}</Button>
          <p className="text-center text-xs text-fg-3">{t('auth.offer.later')}</p>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title={t('auth.welcomeBack')}
      subtitle={t('auth.signInSubtitle')}
      footer={<>{t('auth.noAccount')} <Link to="/auth/signup" className="font-medium text-brand-600 hover:text-brand-700">{t('auth.signUp')}</Link></>}
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <div role="alert" className="rounded-md border border-danger/20 bg-danger-soft px-3 py-2.5 text-sm text-danger-fg">{error}{detail && <p dir="ltr" className="mt-1.5 break-all font-mono text-[11px] text-fg-4">{detail}</p>}</div>}
        <Input label={t('auth.email')} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} inputSize="lg" autoFocus />
        <PasswordInput
          label={t('auth.password')}
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          inputSize="lg"
        />
        <div className="flex justify-end">
          <Link to="/auth/forgot-password" className="text-sm font-medium text-brand-600 hover:text-brand-700">{t('auth.forgot')}</Link>
        </div>
        <Button type="submit" variant="primary" size="lg" fullWidth loading={busy} disabled={!email || !password}>{t('auth.signIn')}</Button>
        {passkeysSupported() && (
          <>
            <div className="flex items-center gap-3 text-xs text-fg-3" aria-hidden><span className="h-px flex-1 bg-line" />{t('auth.or')}<span className="h-px flex-1 bg-line" /></div>
            <Button size="lg" fullWidth icon={<Fingerprint className="size-5" />} loading={passkeyBusy} onClick={passkey}>{t('auth.signInWithPasskey')}</Button>
          </>
        )}
      </form>
    </AuthShell>
  )
}
