import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AuthMe } from '@pluse/types'
import * as api from '@/api/client'
import { localeLabel, nextLocale, useI18n } from '@/i18n'
import { MoonIcon, SunIcon } from '@/views/components/icons'
import type { ThemeMode } from '@/views/utils/theme'

interface LoginPageProps {
  onAuthenticated?: (auth: AuthMe) => void
  theme: ThemeMode
  onToggleTheme: () => void
}

export function LoginPage({ onAuthenticated, theme, onToggleTheme }: LoginPageProps) {
  const { locale, setLocale, t } = useI18n()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function finalizeLogin() {
    const authResult = await api.getAuthMe()
    if (authResult.ok && authResult.data.authenticated) {
      onAuthenticated?.(authResult.data)
      navigate('/', { replace: true })
      return
    }
    window.location.replace('/')
  }

  async function handlePasswordLogin(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    const result = await api.login({ username, password })
    if (!result.ok) {
      setError(result.error)
      return
    }
    await finalizeLogin()
  }

  async function handleTokenLogin(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    const result = await api.login({ token })
    if (!result.ok) {
      setError(result.error)
      return
    }
    await finalizeLogin()
  }

  return (
    <div className="pluse-login">
        <div className="pluse-login-card">
          <div className="pluse-login-card-topbar">
            <button
              type="button"
              className="pluse-button pluse-button-ghost pluse-button-compact"
              onClick={() => setLocale(nextLocale(locale))}
              aria-label={t('切换语言')}
              title={t('切换语言')}
            >
              {localeLabel(nextLocale(locale))}
            </button>
            <button
              type="button"
              className="pluse-icon-button pluse-header-action-icon pluse-theme-toggle"
              onClick={onToggleTheme}
              aria-label={theme === 'dark' ? t('切换到浅色模式') : t('切换到深色模式')}
              title={theme === 'dark' ? t('切换到浅色模式') : t('切换到深色模式')}
            >
              {theme === 'dark' ? <SunIcon className="pluse-icon" /> : <MoonIcon className="pluse-icon" />}
            </button>
          </div>
          <h1>Pluse</h1>
          <p>{t('单端口、本地优先，项目、会话、任务与 Todo 共用同一个工作域。')}</p>

        <form className="pluse-login-form" onSubmit={handlePasswordLogin}>
          <label>{t('用户名')}</label>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            placeholder={t('输入用户名')}
          />
          <label>{t('密码')}</label>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            placeholder={t('输入密码')}
          />
          <button type="submit" className="pluse-button">{t('密码登录')}</button>
        </form>

        <form className="pluse-login-form" onSubmit={handleTokenLogin}>
          <label>{t('API Token')}</label>
          <input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="off"
            placeholder={t('输入 API Token')}
          />
          <button type="submit" className="pluse-button pluse-button-ghost">{t('Token 登录')}</button>
        </form>

        {error && <p className="pluse-error">{error}</p>}
      </div>
    </div>
  )
}
