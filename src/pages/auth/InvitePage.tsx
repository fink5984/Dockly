import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useI18n } from '@/contexts/I18nContext'
import { useAuth } from '@/contexts/AuthContext'
import { authApi } from '@/services'
import { ApiError } from '@/lib/api'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { Spinner } from '@/components/ui/States'
import { AuthShell, PasswordInput } from './AuthShell'
import type { Role } from '@/types'

export default function InvitePage() {
  const { token = '' } = useParams()
  const { t } = useI18n()
  const { acceptInvite } = useAuth()
  const navigate = useNavigate()
  const [invite, setInvite] = useState<{ email: string; name: string; role: Role; workspaceName: string } | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'expired'>('loading')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    authApi.invite(token)
      .then((i) => { setInvite(i); setName(i.name); setState('ready') })
      .catch((err) => setState(err instanceof ApiError && err.status === 410 && err.code === 'invite_expired' ? 'expired' : 'invalid'))
  }, [token])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) { setError(t('auth.passwordHint')); return }
    setBusy(true)
    setError('')
    try {
      await acceptInvite(token, name.trim(), password)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.loadFailedHint'))
    } finally {
      setBusy(false)
    }
  }

  if (state === 'loading') return <AuthShell title="…"><Spinner /></AuthShell>
  if (state !== 'ready' || !invite) {
    return (
      <AuthShell title={t('auth.inviteTitle', { workspace: 'Dockly' })} subtitle={state === 'expired' ? t('auth.inviteExpired') : t('auth.inviteInvalid')}>
        <Button to="/auth/signin" variant="secondary" fullWidth>{t('auth.backToSignIn')}</Button>
      </AuthShell>
    )
  }
  return (
    <AuthShell title={t('auth.inviteTitle', { workspace: invite.workspaceName })} subtitle={t('auth.inviteSubtitle', { role: t(`roles.${invite.role}`) })}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <div role="alert" className="rounded-md bg-danger-soft px-3 py-2.5 text-sm text-danger-fg">{error}</div>}
        <Input label={t('auth.email')} value={invite.email} disabled inputSize="lg" />
        <Input label={t('auth.name')} value={name} onChange={(e) => setName(e.target.value)} required inputSize="lg" autoFocus />
        <PasswordInput label={t('auth.password')} value={password} onChange={(e) => setPassword(e.target.value)} hint={t('auth.passwordHint')} autoComplete="new-password" required inputSize="lg" />
        <Button type="submit" variant="primary" size="lg" fullWidth loading={busy} disabled={!name.trim()}>{t('auth.acceptInvite')}</Button>
      </form>
    </AuthShell>
  )
}
