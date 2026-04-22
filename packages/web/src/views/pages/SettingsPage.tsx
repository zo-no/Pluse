import { useEffect, useState } from 'react'
import * as api from '@/api/client'
import { useI18n } from '@/i18n'

const NOTIFY_HOOK_ID = 'notify-on-session-complete'
const NOTIFY_FAILED_HOOK_ID = 'notify-on-session-failed'
const SPEAK_HOOK_ID = 'speak-on-session-complete'
const CLASSIFY_HOOK_ID = 'classify-first-session-run'

export function SettingsPage() {
  const { t } = useI18n()
  const [globalSystemPrompt, setGlobalSystemPrompt] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [notifyOnComplete, setNotifyOnComplete] = useState(true)
  const [notifyOnFailed, setNotifyOnFailed] = useState(true)
  const [hookLoading, setHookLoading] = useState(true)
  const [hookSaving, setHookSaving] = useState(false)

  const [kairosInstalled, setKairosInstalled] = useState<boolean | null>(null)
  const [kairosInstalling, setKairosInstalling] = useState(false)
  const [kairosError, setKairosError] = useState<string | null>(null)
  const [speakOnComplete, setSpeakOnComplete] = useState(false)
  const [classifyOnFirstRun, setClassifyOnFirstRun] = useState(false)

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
    if (!result.ok) {
      console.error('[hooks] Failed to load hooks config:', result.error)
      return
    }
    const hook = result.data.hooks.find((h) => h.id === NOTIFY_HOOK_ID)
    setNotifyOnComplete(hook ? hook.enabled !== false : true)
    const failedHook = result.data.hooks.find((h) => h.id === NOTIFY_FAILED_HOOK_ID)
    setNotifyOnFailed(failedHook ? failedHook.enabled !== false : true)
    const speakHook = result.data.hooks.find((h) => h.id === SPEAK_HOOK_ID)
    setSpeakOnComplete(speakHook ? speakHook.enabled === true : false)
    const classifyHook = result.data.hooks.find((h) => h.id === CLASSIFY_HOOK_ID)
    setClassifyOnFirstRun(classifyHook ? classifyHook.enabled === true : false)
  }

  async function loadKairosStatus() {
    const result = await api.getKairosStatus()
    if (!result.ok) { setKairosInstalled(false); return }
    setKairosInstalled(result.data.installed)
  }

  useEffect(() => {
    void loadSettings()
    void loadHooks()
    void loadKairosStatus()
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

  async function handleToggleNotifyFailed(enabled: boolean) {
    setNotifyOnFailed(enabled)
    setHookSaving(true)
    await api.updateHook(NOTIFY_FAILED_HOOK_ID, enabled)
    setHookSaving(false)
  }

  async function handleInstallKairos() {
    setKairosInstalling(true)
    setKairosError(null)
    const result = await api.installKairos()
    setKairosInstalling(false)
    if (!result.ok) {
      setKairosError(result.error ?? '安装失败')
      return
    }
    setKairosInstalled(true)
  }

  async function handleToggleSpeak(enabled: boolean) {
    setSpeakOnComplete(enabled)
    setHookSaving(true)
    await api.updateHook(SPEAK_HOOK_ID, enabled)
    setHookSaving(false)
  }

  async function handleToggleClassify(enabled: boolean) {
    setClassifyOnFirstRun(enabled)
    setHookSaving(true)
    await api.updateHook(CLASSIFY_HOOK_ID, enabled)
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
            <div className="pluse-settings-toggle-row">
              <div className="pluse-settings-toggle-info">
                <span className="pluse-settings-toggle-label">{t('会话失败后创建待办')}</span>
                <span className="pluse-settings-toggle-desc">
                  {t('AI 执行出错时，自动在待办列表创建提醒')}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={notifyOnFailed}
                className={`pluse-settings-toggle${notifyOnFailed ? ' is-on' : ''}`}
                onClick={() => void handleToggleNotifyFailed(!notifyOnFailed)}
                disabled={hookLoading || hookSaving}
              >
                <span className="pluse-settings-toggle-thumb" />
              </button>
            </div>
            <div className="pluse-settings-toggle-row">
              <div className="pluse-settings-toggle-info">
                <span className="pluse-settings-toggle-label">{t('会话完成后语音播报')}</span>
                <span className="pluse-settings-toggle-desc">
                  {kairosInstalled === null
                    ? t('检测中…')
                    : kairosInstalled
                    ? t('由 kairos 驱动，可用 kairos config set voice Tingting 切换音色')
                    : kairosError
                    ? kairosError
                    : t('需要先安装 kairos')}
                </span>
              </div>
              {kairosInstalled === null ? (
                <span className="pluse-settings-toggle-loading">…</span>
              ) : kairosInstalled ? (
                <button
                  type="button"
                  role="switch"
                  aria-checked={speakOnComplete}
                  className={`pluse-settings-toggle${speakOnComplete ? ' is-on' : ''}`}
                  onClick={() => void handleToggleSpeak(!speakOnComplete)}
                  disabled={hookLoading || hookSaving}
                >
                  <span className="pluse-settings-toggle-thumb" />
                </button>
              ) : (
                <button
                  type="button"
                  className="pluse-button pluse-button-sm"
                  onClick={() => void handleInstallKairos()}
                  disabled={kairosInstalling}
                >
                  {kairosInstalling ? t('安装中…') : t('一键安装')}
                </button>
              )}
            </div>
          </section>

          <section className="pluse-detail-section pluse-settings-section">
            <header className="pluse-detail-section-head">
              <h2 className="pluse-settings-section-title">{t('元数据补全')}</h2>
              <p className="pluse-settings-section-desc">
                {t('用于在首轮会话结束后补全会话的辅助元数据。')}
              </p>
            </header>
            <div className="pluse-settings-toggle-row">
              <div className="pluse-settings-toggle-info">
                <span className="pluse-settings-toggle-label">{t('首轮会话后自动分类')}</span>
                <span className="pluse-settings-toggle-desc">
                  {t('首个 chat run 完成后，Agent 会尝试复用或新建会话分类。')}
                </span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={classifyOnFirstRun}
                className={`pluse-settings-toggle${classifyOnFirstRun ? ' is-on' : ''}`}
                onClick={() => void handleToggleClassify(!classifyOnFirstRun)}
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
