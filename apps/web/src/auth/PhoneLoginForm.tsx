import React from 'react'
import { IconEye, IconEyeOff } from '@tabler/icons-react'
import { loginWithCredentials } from '../api/server'
import { toast } from '../ui/toast'
import type { User } from './store'

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export interface PhoneLoginFormProps {
  onLoginSuccess: (user: User) => void
}

export function PhoneLoginForm({ onLoginSuccess }: PhoneLoginFormProps): JSX.Element {
  const [phone, setPhone] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [showPassword, setShowPassword] = React.useState(false)
  const [loading, setLoading] = React.useState(false)

  const handleLogin = React.useCallback(async (event?: React.FormEvent) => {
    event?.preventDefault()
    const normalizedPhone = phone.trim()
    if (!normalizedPhone) { toast('请输入手机号', 'error'); return }
    if (!password) { toast('请输入密码', 'error'); return }
    if (loading) return
    setLoading(true)
    try {
      const { user } = await loginWithCredentials(normalizedPhone, password)
      onLoginSuccess(user)
    } catch (error) {
      console.error('Phone login failed', error)
      toast(getErrorMessage(error, '手机号密码登录失败，请稍后再试'), 'error')
    } finally {
      setLoading(false)
    }
  }, [loading, onLoginSuccess, password, phone])

  return (
    <form className="tc-auth-form" onSubmit={(event) => void handleLogin(event)}>
      <div className="tc-auth-field">
        <label className="tc-auth-field__label" htmlFor="tc-login-phone">手机号</label>
        <input
          id="tc-login-phone"
          className="tc-auth-input"
          type="tel"
          placeholder="请输入手机号"
          value={phone}
          onChange={(event) => setPhone(event.currentTarget.value)}
          maxLength={11}
          autoComplete="username"
        />
      </div>

      <div className="tc-auth-field">
        <label className="tc-auth-field__label" htmlFor="tc-login-password">密码</label>
        <div className="tc-auth-password">
          <input
            id="tc-login-password"
            className="tc-auth-input tc-auth-input--password"
            type={showPassword ? 'text' : 'password'}
            placeholder="请输入密码"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            autoComplete="current-password"
          />
          <button
            type="button"
            className="tc-auth-toggle"
            aria-label={showPassword ? '隐藏密码' : '显示密码'}
            title={showPassword ? '隐藏密码' : '显示密码'}
            onClick={() => setShowPassword((value) => !value)}
          >
            {showPassword ? <IconEyeOff size={15} /> : <IconEye size={15} />}
          </button>
        </div>
      </div>

      <button className="tc-auth-submit" type="submit" disabled={loading || !phone.trim() || !password}>
        {loading ? '登录中...' : '开始你的创作'}
      </button>
    </form>
  )
}
