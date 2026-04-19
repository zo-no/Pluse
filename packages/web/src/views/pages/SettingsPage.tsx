import { useEffect, useState } from 'react'
import * as api from '@/api/client'
import { useI18n } from '@/i18n'

export function SettingsPage() {
  const { t } = useI18n()
  const [globalSystemPrompt, setGlobalSystemPrompt] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function loadSettings() {
    setLoading(true)
    const result = await api.getSettings()
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setGlobalSystemPrompt(result.data.globalSystemPrompt ?? '')
    setError(null)
  }

  useEffect(() => {
    void loadSettings()
  }, [])

  async function handleSave() {
    setSaving(true)
    const result = await api.updateSettings({ globalSystemPrompt })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setGlobalSystemPrompt(result.data.globalSystemPrompt ?? '')
    setError(null)
  }

  return (
    <div className="pluse-page pluse-project-page pluse-settings-page">
      <div className="pluse-detail-shell">
        <div className="pluse-detail-hero pluse-settings-hero">
          <div className="pluse-detail-hero-main">
            <div className="pluse-detail-title-row pluse-settings-title-row">
              <h1 className="pluse-info-path pluse-settings-title">{t('系统 Prompt')}</h1>
              <span className="pluse-inline-pill pluse-settings-scope-pill">{t('全局')}</span>
            </div>
            <p className="pluse-detail-summary">
              {t('作用于所有项目。项目级 Prompt 在各项目设置里单独编辑。')}
            </p>
          </div>
        </div>

        <div className="pluse-detail-grid pluse-settings-grid">
          <section className="pluse-detail-section">
            <header className="pluse-detail-section-head">
              <div>
                <h2>{t('编辑')}</h2>
                <p>{t('留空则不注入全局系统 Prompt。')}</p>
              </div>
            </header>
            <textarea
              value={globalSystemPrompt}
              onChange={(event) => setGlobalSystemPrompt(event.target.value)}
              rows={14}
              placeholder={t('输入全局系统 Prompt')}
            />
            <p className="pluse-info-copy">{t('当前内容会先于项目 Prompt 注入到所有 Quest。')}</p>
          </section>

          <div className="pluse-settings-actions">
            <button type="button" className="pluse-button" onClick={() => void handleSave()} disabled={saving || loading}>
              {saving ? t('保存中…') : loading ? t('加载中…') : t('保存')}
            </button>
          </div>

          {error ? <p className="pluse-error pluse-detail-error">{error}</p> : null}
        </div>
      </div>
    </div>
  )
}
