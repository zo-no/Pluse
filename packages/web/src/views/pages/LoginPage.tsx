import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { AuthMe } from '@melody-sync/types'
import * as api from '@/api/client'

interface LoginPageProps {
  onAuthenticated?: (auth: AuthMe) => void
}

export function LoginPage({ onAuthenticated }: LoginPageProps) {
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
    <div className="pulse-login">
      <div className="pulse-login-card">
        <h1>Pulse</h1>
        <p>单端口、本地优先，项目 / 会话 / 任务共用同一个工作域。</p>

        <form className="pulse-login-form" onSubmit={handlePasswordLogin}>
          <label>用户名</label>
          <input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            placeholder="输入用户名"
          />
          <label>密码</label>
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            placeholder="输入密码"
          />
          <button type="submit" className="pulse-button">密码登录</button>
        </form>

        <form className="pulse-login-form" onSubmit={handleTokenLogin}>
          <label>API Token</label>
          <input
            value={token}
            onChange={(event) => setToken(event.target.value)}
            autoComplete="off"
            placeholder="输入 API Token"
          />
          <button type="submit" className="pulse-button pulse-button-ghost">Token 登录</button>
        </form>

        {error && <p className="pulse-error">{error}</p>}
      </div>
    </div>
  )
}
