import { useState, useEffect } from 'react'
import { useI18n } from '@/contexts/I18nContext'
import { useTheme } from '@/contexts/ThemeContext'
import { useAuth } from '@/contexts/AuthContext'
import { Card, CardHeader, CardContent } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Select, Textarea } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Tabs, useTabState } from '@/components/ui/Tabs'
import { cn } from '@/lib/utils'
import { useSupabaseData } from '@/hooks/useSupabaseData'
import { getCaseTypeConfigs, updateWorkspace, upsertCaseTypeConfig, deleteCaseTypeConfig } from '@/services/settingsService'
import { getDocumentTypes, createDocumentType, updateDocumentType, deleteDocumentType } from '@/services/documentsService'
import {
  Building, Users, Shield, FileText, Bell, Clock, Link, Palette, Globe, Lock,
  Plus, Edit2, Trash2, Save, Eye, ChevronRight, Mail, Database, Upload, Key
} from 'lucide-react'

export function SettingsPage() {
  const { t, language, setLanguage } = useI18n()
  const { theme, setTheme } = useTheme()
  const { user, workspace, refreshProfile } = useAuth()

  const { data: allCaseTypeConfigs, refetch: refetchCaseTypes } = useSupabaseData(getCaseTypeConfigs, [])
  const { data: allDocumentTypes, refetch: refetchDocTypes } = useSupabaseData(getDocumentTypes, [])

  // Case type modal state
  const [caseTypeModalOpen, setCaseTypeModalOpen] = useState(false)
  const [editingCaseType, setEditingCaseType] = useState<{ id: string; name: string; nameHe: string; color: string; isActive: boolean } | null>(null)
  const [caseTypeForm, setCaseTypeForm] = useState({ name: '', color: 'bg-blue-500' })
  const [caseTypeSaving, setCaseTypeSaving] = useState(false)
  const [caseTypeError, setCaseTypeError] = useState('')

  // Document type modal state
  const [docTypeModalOpen, setDocTypeModalOpen] = useState(false)
  const [editingDocType, setEditingDocType] = useState<{ id: string; name: string; category: string; description: string; isRequired: boolean } | null>(null)
  const [docTypeForm, setDocTypeForm] = useState({ name: '', category: 'general', description: '', isRequired: false })
  const [docTypeSaving, setDocTypeSaving] = useState(false)
  const [docTypeError, setDocTypeError] = useState('')

  const CASE_TYPE_COLORS = [
    { value: 'bg-blue-500', label: 'Blue' },
    { value: 'bg-green-500', label: 'Green' },
    { value: 'bg-purple-500', label: 'Purple' },
    { value: 'bg-orange-500', label: 'Orange' },
    { value: 'bg-red-500', label: 'Red' },
    { value: 'bg-teal-500', label: 'Teal' },
    { value: 'bg-pink-500', label: 'Pink' },
    { value: 'bg-indigo-500', label: 'Indigo' },
  ]

  const DOC_CATEGORIES = [
    { value: 'general', label: t('settings.docCatGeneral') },
    { value: 'identity', label: t('settings.docCatIdentity') },
    { value: 'financial', label: t('settings.docCatFinancial') },
    { value: 'legal', label: t('settings.docCatLegal') },
    { value: 'property', label: t('settings.docCatProperty') },
  ]

  const openAddCaseType = () => {
    setCaseTypeForm({ name: '', color: 'bg-blue-500' })
    setEditingCaseType(null)
    setCaseTypeError('')
    setCaseTypeModalOpen(true)
  }

  const openEditCaseType = (ct: { id: string; name: string; nameHe: string; color: string; isActive: boolean }) => {
    setCaseTypeForm({ name: ct.name, color: ct.color })
    setEditingCaseType(ct)
    setCaseTypeError('')
    setCaseTypeModalOpen(true)
  }

  const handleSaveCaseType = async () => {
    if (!caseTypeForm.name.trim()) {
      setCaseTypeError(t('settings.caseTypeNameRequired'))
      return
    }
    const wsId = workspace?.id || user?.workspaceId || ''
    if (!wsId) return
    setCaseTypeSaving(true)
    setCaseTypeError('')
    try {
      const id = editingCaseType?.id || caseTypeForm.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
      await upsertCaseTypeConfig(wsId, {
        id,
        name: caseTypeForm.name.trim(),
        color: caseTypeForm.color,
        isActive: editingCaseType?.isActive ?? true,
      })
      setCaseTypeModalOpen(false)
      refetchCaseTypes()
    } catch (err: any) {
      setCaseTypeError(err?.message || 'Failed to save')
    } finally {
      setCaseTypeSaving(false)
    }
  }

  const handleDeleteCaseType = async (id: string) => {
    try {
      await deleteCaseTypeConfig(id)
      refetchCaseTypes()
    } catch (err) {
      console.error('Failed to delete case type:', err)
    }
  }

  // Document type handlers
  const openAddDocType = () => {
    setDocTypeForm({ name: '', category: 'general', description: '', isRequired: false })
    setEditingDocType(null)
    setDocTypeError('')
    setDocTypeModalOpen(true)
  }

  const openEditDocType = (dt: { id: string; name: string; category: string; description: string; isRequired: boolean }) => {
    setDocTypeForm({ name: dt.name, category: dt.category, description: dt.description, isRequired: dt.isRequired })
    setEditingDocType(dt)
    setDocTypeError('')
    setDocTypeModalOpen(true)
  }

  const handleSaveDocType = async () => {
    if (!docTypeForm.name.trim()) {
      setDocTypeError(t('settings.docTypeNameRequired'))
      return
    }
    const wsId = workspace?.id || user?.workspaceId || ''
    if (!wsId) return
    setDocTypeSaving(true)
    setDocTypeError('')
    try {
      if (editingDocType) {
        await updateDocumentType(editingDocType.id, {
          name: docTypeForm.name.trim(),
          category: docTypeForm.category,
          description: docTypeForm.description.trim(),
          isRequired: docTypeForm.isRequired,
        })
      } else {
        await createDocumentType(wsId, {
          name: docTypeForm.name.trim(),
          category: docTypeForm.category,
          description: docTypeForm.description.trim(),
          isRequired: docTypeForm.isRequired,
        })
      }
      setDocTypeModalOpen(false)
      refetchDocTypes()
    } catch (err: any) {
      setDocTypeError(err?.message || 'Failed to save')
    } finally {
      setDocTypeSaving(false)
    }
  }

  const handleDeleteDocType = async (id: string) => {
    try {
      await deleteDocumentType(id)
      refetchDocTypes()
    } catch (err) {
      console.error('Failed to delete document type:', err)
    }
  }

  // Workspace form state
  const [wsForm, setWsForm] = useState({
    name: '',
    businessType: '',
    email: '',
    phone: '',
    contactPerson: '',
  })
  const [wsSaving, setWsSaving] = useState(false)
  const [wsSuccess, setWsSuccess] = useState(false)

  // Populate form from workspace data
  useEffect(() => {
    if (workspace) {
      setWsForm({
        name: workspace.name || '',
        businessType: workspace.businessType || 'other',
        email: workspace.email || '',
        phone: workspace.phone || '',
        contactPerson: workspace.contactPerson || '',
      })
    }
  }, [workspace])

  const handleSaveWorkspace = async () => {
    if (!workspace?.id) return
    setWsSaving(true)
    setWsSuccess(false)
    try {
      await updateWorkspace(workspace.id, {
        name: wsForm.name,
        businessType: wsForm.businessType,
        email: wsForm.email,
        phone: wsForm.phone,
        contactPerson: wsForm.contactPerson,
      })
      await refreshProfile()
      setWsSuccess(true)
      setTimeout(() => setWsSuccess(false), 3000)
    } catch (err) {
      console.error('Failed to save workspace:', err)
    } finally {
      setWsSaving(false)
    }
  }

  const { activeTab, setActiveTab, tabs } = useTabState([
    { id: 'workspace', label: t('settings.workspace') },
    { id: 'staff', label: t('settings.staff') },
    { id: 'case-types', label: t('settings.caseTypes') },
    { id: 'doc-types', label: t('settings.documentTypes') },
    { id: 'notifications', label: t('settings.notifications') },
    { id: 'appearance', label: t('settings.appearance') },
    { id: 'integrations', label: t('settings.integrations') },
  ])

  const staffMembers = [
    { id: user?.id || '1', name: user?.name || '', email: user?.email || '', role: (user?.role || 'owner') as string, avatar: null },
  ]

  const roleColors: Record<string, string> = { owner: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300', admin: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300', member: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">{t('settings.title')}</h1>
        <p className="text-sm text-[var(--text-tertiary)] mt-1">{t('settings.subtitle')}</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Sidebar nav */}
        <div className="lg:w-56 shrink-0">
          <nav className="space-y-1">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-start transition-colors',
                  activeTab === tab.id
                    ? 'bg-primary-50 dark:bg-primary-950/30 text-primary-700 dark:text-primary-300 font-medium'
                    : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]'
                )}
              >
                {tab.id === 'workspace' && <Building className="w-4 h-4" />}
                {tab.id === 'staff' && <Users className="w-4 h-4" />}
                {tab.id === 'case-types' && <FileText className="w-4 h-4" />}
                {tab.id === 'notifications' && <Bell className="w-4 h-4" />}
                {tab.id === 'appearance' && <Palette className="w-4 h-4" />}
                {tab.id === 'integrations' && <Link className="w-4 h-4" />}
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-4">
          {activeTab === 'workspace' && (
            <>
              <Card>
                <CardHeader title={t('settings.workspaceDetails')} />
                <CardContent>
                  <div className="space-y-4 max-w-lg">
                    {wsSuccess && (
                      <div className="p-3 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-400 text-sm">
                        {t('common.saved') || 'Saved successfully'}
                      </div>
                    )}
                    <Input label={t('settings.workspaceName')} value={wsForm.name} onChange={e => setWsForm(p => ({ ...p, name: e.target.value }))} />
                    <Select
                      label={t('settings.businessType')}
                      value={wsForm.businessType}
                      onChange={e => setWsForm(p => ({ ...p, businessType: e.target.value }))}
                      options={[
                        { value: 'mortgage', label: t('businessTypes.mortgage') },
                        { value: 'law', label: t('businessTypes.law') },
                        { value: 'accounting', label: t('businessTypes.accounting') },
                        { value: 'insurance', label: t('businessTypes.insurance') },
                        { value: 'admin', label: t('businessTypes.admin') },
                        { value: 'other', label: t('businessTypes.other') },
                      ]}
                    />
                    <Input label={t('onboarding.contactPerson')} value={wsForm.contactPerson} onChange={e => setWsForm(p => ({ ...p, contactPerson: e.target.value }))} />
                    <Input label={t('settings.companyEmail')} type="email" value={wsForm.email} onChange={e => setWsForm(p => ({ ...p, email: e.target.value }))} />
                    <Input label={t('settings.phone')} type="tel" value={wsForm.phone} onChange={e => setWsForm(p => ({ ...p, phone: e.target.value }))} />
                    <div className="pt-2">
                      <Button onClick={handleSaveWorkspace} loading={wsSaving} icon={<Save className="w-4 h-4" />}>{t('common.save')}</Button>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader title={t('settings.dataRetention')} />
                <CardContent>
                  <div className="space-y-3 max-w-lg">
                    <Select
                      label={t('settings.documentRetention')}
                      defaultValue="365"
                      options={[
                        { value: '90', label: '90 ' + t('common.days') },
                        { value: '180', label: '180 ' + t('common.days') },
                        { value: '365', label: '1 ' + t('common.year') },
                        { value: '730', label: '2 ' + t('common.years') },
                        { value: '0', label: t('settings.keepForever') },
                      ]}
                    />
                    <Select
                      label={t('settings.archivedCases')}
                      defaultValue="730"
                      options={[
                        { value: '365', label: '1 ' + t('common.year') },
                        { value: '730', label: '2 ' + t('common.years') },
                        { value: '0', label: t('settings.keepForever') },
                      ]}
                    />
                    <Button variant="outline" icon={<Save className="w-4 h-4" />}>{t('common.save')}</Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {activeTab === 'staff' && (
            <>
              <div className="flex justify-between items-center">
                <p className="text-sm text-[var(--text-tertiary)]">{staffMembers.length} {t('settings.teamMembers')}</p>
                <Button icon={<Plus className="w-4 h-4" />} size="sm">{t('settings.inviteMember')}</Button>
              </div>

              <div className="space-y-2">
                {staffMembers.map(member => (
                  <Card key={member.id}>
                    <div className="flex items-center gap-4 p-4">
                      <div className="w-10 h-10 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center text-primary-700 dark:text-primary-300 font-bold text-sm">
                        {member.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{member.name}</p>
                        <p className="text-xs text-[var(--text-tertiary)]">{member.email}</p>
                      </div>
                      <span className={cn('text-xs px-2.5 py-1 rounded-full font-medium capitalize', roleColors[member.role])}>
                        {member.role}
                      </span>
                      <div className="flex gap-1">
                        <button className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]"><Edit2 className="w-3.5 h-3.5" /></button>
                        {member.role !== 'owner' && (
                          <button className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </>
          )}

          {activeTab === 'case-types' && (
            <>
              <div className="flex justify-between items-center">
                <p className="text-sm text-[var(--text-tertiary)]">{allCaseTypeConfigs.length} {t('settings.caseTypesConfigured')}</p>
                <Button onClick={openAddCaseType} icon={<Plus className="w-4 h-4" />} size="sm">{t('settings.addCaseType')}</Button>
              </div>

              {allCaseTypeConfigs.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <FileText className="w-10 h-10 text-[var(--text-tertiary)] mx-auto mb-3" />
                    <p className="text-sm font-medium mb-1">{t('settings.noCaseTypes')}</p>
                    <p className="text-xs text-[var(--text-tertiary)] mb-4">{t('settings.noCaseTypesDesc')}</p>
                    <Button onClick={openAddCaseType} icon={<Plus className="w-4 h-4" />} size="sm">{t('settings.addCaseType')}</Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  {allCaseTypeConfigs.map(ct => (
                    <Card key={ct.id}>
                      <div className="flex items-center gap-4 p-4">
                        <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center text-white', ct.color)}>
                          <FileText className="w-5 h-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{ct.name}</p>
                          {ct.nameHe && <p className="text-xs text-[var(--text-tertiary)]">{ct.nameHe}</p>}
                        </div>
                        <Badge variant="status" status={ct.isActive ? 'approved' : 'missing'} size="sm">
                          {ct.isActive ? t('common.active') : t('common.inactive')}
                        </Badge>
                        <button onClick={() => openEditCaseType(ct)} className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDeleteCaseType(ct.id)} className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-red-400">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === 'doc-types' && (
            <>
              <div className="flex justify-between items-center">
                <p className="text-sm text-[var(--text-tertiary)]">{allDocumentTypes.length} {t('settings.docTypesConfigured')}</p>
                <Button onClick={openAddDocType} icon={<Plus className="w-4 h-4" />} size="sm">{t('settings.addDocType')}</Button>
              </div>

              {allDocumentTypes.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <Upload className="w-10 h-10 text-[var(--text-tertiary)] mx-auto mb-3" />
                    <p className="text-sm font-medium mb-1">{t('settings.noDocTypes')}</p>
                    <p className="text-xs text-[var(--text-tertiary)] mb-4">{t('settings.noDocTypesDesc')}</p>
                    <Button onClick={openAddDocType} icon={<Plus className="w-4 h-4" />} size="sm">{t('settings.addDocType')}</Button>
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-2">
                  {allDocumentTypes.map(dt => (
                    <Card key={dt.id}>
                      <div className="flex items-center gap-4 p-4">
                        <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-950/30 flex items-center justify-center">
                          <FileText className="w-5 h-5 text-primary-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{dt.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs text-[var(--text-tertiary)]">{DOC_CATEGORIES.find(c => c.value === dt.category)?.label || dt.category}</span>
                            {dt.isRequired && (
                              <Badge variant="status" status="pending" size="sm">{t('settings.required')}</Badge>
                            )}
                          </div>
                        </div>
                        <Badge variant="status" status={dt.status === 'active' ? 'approved' : 'missing'} size="sm">
                          {dt.status === 'active' ? t('common.active') : t('common.inactive')}
                        </Badge>
                        <button onClick={() => openEditDocType(dt)} className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => handleDeleteDocType(dt.id)} className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-red-400">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}

          {activeTab === 'notifications' && (
            <Card>
              <CardHeader title={t('settings.notificationPreferences')} />
              <CardContent>
                <div className="space-y-3">
                  {[
                    { key: 'newDocument', label: t('settings.notifyNewDocument'), desc: t('settings.notifyNewDocumentDesc') },
                    { key: 'supportRequest', label: t('settings.notifySupportRequest'), desc: t('settings.notifySupportRequestDesc') },
                    { key: 'caseCompleted', label: t('settings.notifyCaseCompleted'), desc: t('settings.notifyCaseCompletedDesc') },
                    { key: 'dailySummary', label: t('settings.notifyDailySummary'), desc: t('settings.notifyDailySummaryDesc') },
                    { key: 'deadlineReminder', label: t('settings.notifyDeadlineReminder'), desc: t('settings.notifyDeadlineReminderDesc') },
                  ].map((item) => (
                    <label key={item.key} className="flex items-start gap-3 p-3 bg-[var(--bg-tertiary)] rounded-lg cursor-pointer">
                      <input type="checkbox" defaultChecked className="mt-1 rounded" />
                      <div>
                        <p className="text-sm font-medium">{item.label}</p>
                        <p className="text-xs text-[var(--text-tertiary)]">{item.desc}</p>
                      </div>
                    </label>
                  ))}
                  <div className="pt-2">
                    <Button icon={<Save className="w-4 h-4" />}>{t('common.save')}</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === 'appearance' && (
            <Card>
              <CardHeader title={t('settings.appearanceSettings')} />
              <CardContent>
                <div className="space-y-6 max-w-lg">
                  <div>
                    <p className="text-sm font-medium mb-3">{t('settings.theme')}</p>
                    <div className="grid grid-cols-3 gap-3">
                      {(['light', 'dark', 'system'] as const).map(opt => (
                        <button
                          key={opt}
                          onClick={() => setTheme(opt)}
                          className={cn(
                            'p-3 rounded-xl border-2 text-center transition-all',
                            theme === opt ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/30' : 'border-[var(--border-primary)] hover:border-[var(--border-secondary)]'
                          )}
                        >
                          <p className="text-sm font-medium capitalize">{t(`settings.${opt}`)}</p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium mb-3">{t('common.language')}</p>
                    <div className="grid grid-cols-2 gap-3">
                      {([{ code: 'en' as const, label: 'English' }, { code: 'he' as const, label: 'עברית' }]).map(opt => (
                        <button
                          key={opt.code}
                          onClick={() => setLanguage(opt.code)}
                          className={cn(
                            'p-3 rounded-xl border-2 text-center transition-all',
                            language === opt.code ? 'border-primary-500 bg-primary-50 dark:bg-primary-950/30' : 'border-[var(--border-primary)] hover:border-[var(--border-secondary)]'
                          )}
                        >
                          <p className="text-sm font-medium">{opt.label}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {activeTab === 'integrations' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {[
                { name: 'WhatsApp Business', desc: t('settings.whatsappDesc'), icon: '💬', connected: true, color: 'bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-800' },
                { name: 'Supabase', desc: t('settings.supabaseDesc'), icon: '⚡', connected: true, color: 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800' },
                { name: 'Google Drive', desc: t('settings.googleDriveDesc'), icon: '📁', connected: false, color: 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800' },
                { name: 'Email SMTP', desc: t('settings.emailSmtpDesc'), icon: '📧', connected: true, color: 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800' },
              ].map(integration => (
                <Card key={integration.name}>
                  <div className={cn('p-5 border rounded-xl', integration.color)}>
                    <div className="flex items-start justify-between mb-3">
                      <span className="text-2xl">{integration.icon}</span>
                      <Badge variant="status" status={integration.connected ? 'approved' : 'missing'} size="sm">
                        {integration.connected ? t('common.connected') : t('common.notConnected')}
                      </Badge>
                    </div>
                    <p className="text-sm font-semibold">{integration.name}</p>
                    <p className="text-xs text-[var(--text-tertiary)] mt-1">{integration.desc}</p>
                    <Button variant="outline" size="sm" className="mt-3">
                      {integration.connected ? t('common.configure') : t('common.connect')}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Case Type Modal */}
      <Modal
        isOpen={caseTypeModalOpen}
        onClose={() => setCaseTypeModalOpen(false)}
        title={editingCaseType ? t('settings.editCaseType') : t('settings.addCaseType')}
        size="sm"
      >
        <div className="space-y-5 p-6">
          {caseTypeError && (
            <div className="p-3 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 rounded-lg text-sm">{caseTypeError}</div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1.5">{t('settings.caseTypeName')}</label>
            <Input
              value={caseTypeForm.name}
              onChange={(e) => setCaseTypeForm(f => ({ ...f, name: e.target.value }))}
              placeholder={t('settings.caseTypeNamePlaceholder')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">{t('settings.color')}</label>
            <div className="flex flex-wrap gap-2.5">
              {CASE_TYPE_COLORS.map(c => (
                <button
                  key={c.value}
                  onClick={() => setCaseTypeForm(f => ({ ...f, color: c.value }))}
                  className={cn(
                    'w-9 h-9 rounded-xl transition-all',
                    c.value,
                    caseTypeForm.color === c.value ? 'ring-2 ring-offset-2 ring-primary-500 scale-110' : 'opacity-60 hover:opacity-100'
                  )}
                  title={c.label}
                />
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-primary)]">
            <Button variant="outline" onClick={() => setCaseTypeModalOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleSaveCaseType} loading={caseTypeSaving} icon={<Save className="w-4 h-4" />}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>

      {/* Document Type Modal */}
      <Modal
        isOpen={docTypeModalOpen}
        onClose={() => setDocTypeModalOpen(false)}
        title={editingDocType ? t('settings.editDocType') : t('settings.addDocType')}
        size="md"
      >
        <div className="space-y-5 p-6">
          {docTypeError && (
            <div className="p-3 bg-red-50 dark:bg-red-950/30 text-red-600 dark:text-red-400 rounded-lg text-sm">{docTypeError}</div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1.5">{t('settings.docTypeName')}</label>
            <Input
              value={docTypeForm.name}
              onChange={(e) => setDocTypeForm(f => ({ ...f, name: e.target.value }))}
              placeholder={t('settings.docTypeNamePlaceholder')}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">{t('settings.docTypeCategory')}</label>
            <Select
              value={docTypeForm.category}
              onChange={(e) => setDocTypeForm(f => ({ ...f, category: e.target.value }))}
              options={DOC_CATEGORIES}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">{t('settings.docTypeDescription')}</label>
            <Textarea
              value={docTypeForm.description}
              onChange={(e) => setDocTypeForm(f => ({ ...f, description: e.target.value }))}
              placeholder={t('settings.docTypeDescPlaceholder')}
              rows={2}
            />
          </div>

          <label className="flex items-center gap-3 p-3 bg-[var(--bg-tertiary)] rounded-xl cursor-pointer">
            <input
              type="checkbox"
              checked={docTypeForm.isRequired}
              onChange={(e) => setDocTypeForm(f => ({ ...f, isRequired: e.target.checked }))}
              className="rounded"
            />
            <div>
              <p className="text-sm font-medium">{t('settings.docTypeRequired')}</p>
              <p className="text-xs text-[var(--text-tertiary)]">{t('settings.docTypeRequiredDesc')}</p>
            </div>
          </label>

          <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-primary)]">
            <Button variant="outline" onClick={() => setDocTypeModalOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleSaveDocType} loading={docTypeSaving} icon={<Save className="w-4 h-4" />}>{t('common.save')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
