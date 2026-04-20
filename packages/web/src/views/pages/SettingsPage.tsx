import { useEffect, useState } from 'react'
import * as api from '@/api/client'
import { useI18n } from '@/i18n'

const NOTIFY_HOOK_ID = 'notify-on-session-complete'

export function SettingsPage() {
  const { t } = useI18n()
  const [globalSystemPrompt, setGlobalSystemPrompt] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [notifyOnComplete, setNotifyOnComplete] = useState(true)
  const [hookLoading, setHookLoading] = useState(true)
  const [hookSaving, setHookSaving] = useState(false)

  async function loadSettings() {
    setLoading(true)
    const result = await api.getSettings()
    setLoading(false)
    if (!result.ok) { setError(result.error); return }
    setGlobalSystemPrompt(result.data.globalSystemPrompt ?? '')
    setError(null)
  }

  async function loadHooks() {
    setHookLoading(true)
    const result = await api.getHooks()
    setHookLoading(false)
    if (!result.ok) return
    const hook = result.data.hooks.find((h) => h.id === NOTIFY_HOOK_ID)
    setNotifyOnComplete(hook ? hook.enabled !== false : true)
  }

  useEffect(() => {
    void loadSettings()
    void loadHooks()
  }, [])

  async function handleSave() {
    setSaving(true)
    const result = await api.updateSettings({ globalSystemPrompt })
    setSaving(false)
    if (!result.ok) { setError(result.error); return }
    setGlobalSystemPrompt(result.data.globalSystemPrompt ?? '')
    setError(null)
  }

  async function handleToggleNotify(enabled: boolean) {
    setNotifyOnComplete(enabled)
    setHookSaving(true)
    await api.updateHook(NOTIFY_HOOK_ID, enabled)
    setHookSaving(false)
  }

  return (
    <div className="pluse-page pluse-project-page pluse-settings-page">
      <div className="pluse-detail-shell">
        <div className="pluse-detail-hero pluse-settings-hero">
          <div className="pluse-detail-hero-main">
            <div className="pluse-detail-title-row pluse-settings-title-row">
              <h1 className="pluse-info-path pluse-settings-title">{t('设置')}</h1>
              <span className="pluse-inline-pill pluse-settings-scope-pill">{t('全局')}</span>
            </div>
          </div>
        </div>

        <div className="pluse-detail-grid pluse-settings-grid">

          {/* 通知 */}
          <section className="pluse-detail-section pluse-settings-section">
            <header className="pluse-detail-section-head">
              <h2 className="pluse-settings-section-title">{t('通知')}</h2>
            </header>
            <div className="pluse-settings-toggle-row">
              <div className="pluse-settings-toggle-info">
                <span className="pluse-settings-toggle-label">{t('会话完成后创建待办')}</span>
                <span className="pluse-settings-toggle-desc">
                  {t('AI 完成一轮会话后，自动在待办列表创建提醒')}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={notifyOnComplete}
                className={`pluse-settings-toggle${notifyOnComplete ? ' is-on' : ''}`}
                onClick={() => void handleToggleNotify(!notifyOnComplete)}
                disabled={hookLoading || hookSaving}
              >
                <span className="pluse-settings-toggle-thumb" />
              </button>
            </div>
          </section>

          {/* 系统 Prompt */}
          <section className="pluse-detail-section pluse-settings-section">
            <header className="pluse-detail-section-head">
              <h2 className="pluse-settings-section-title">{t('系统 Prompt')}</h2>
              <p className="pluse-settings-section-desc">
                {t('作用于所有项目。项目级 Prompt 在各项目设置里单独编辑。')}
              </p>
            </header>
            <textarea
              value={globalSystemPrompt}
              onChange={(event) => setGlobalSystemPrompt(event.target.value)}
              rows={12}
              placeholder={t('输入全局系统 Prompt，留空则不注入')}
            />
          </section>

          <div className="pluse-settings-actions">
            {error ? <p className="pluse-error">{error}</p> : null}
            <button
              type="button"
              className="pluse-button"
              onClick={() => void handleSave()}
              disabled={saving || loading}
            >
              {saving ? t('保存中…') : loading ? t('加载中…') : t('保存')}
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}
