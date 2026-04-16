import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import * as api from '@/api/client'

export function LoginPage() {
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handlePasswordLogin(event: React.FormEvent) {
    event.preventDefault()
    const result = await api.login({ password })
    if (!result.ok) {
      setError(result.error)
      return
    }
    navigate('/')
  }

  async function handleTokenLogin(event: React.FormEvent) {
    event.preventDefault()
    const result = await api.login({ token })
    if (!result.ok) {
      setError(result.error)
      return
    }
    navigate('/')
  }

  return (
    <div className="pulse-login">
      <div className="pulse-login-card">
        <h1>Pulse</h1>
        <p>单端口、本地优先，项目 / 会话 / 任务共用同一个工作域。</p>

        <form className="pulse-login-form" onSubmit={handlePasswordLogin}>
          <label>密码</label>
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
          <button type="submit" className="pulse-button">密码登录</button>
        </form>

        <form className="pulse-login-form" onSubmit={handleTokenLogin}>
          <label>API Token</label>
          <input value={token} onChange={(event) => setToken(event.target.value)} />
          <button type="submit" className="pulse-button pulse-button-ghost">Token 登录</button>
        </form>

        {error && <p className="pulse-error">{error}</p>}
      </div>
    </div>
  )
}
