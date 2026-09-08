import React from 'react'
import { IconEye, IconEyeOff } from '@tabler/icons-react'
import { registerWithPhoneAndPassword, sendPhoneVerifyCode } from '../api/server'
import { toast } from '../ui/toast'
import type { User } from './store'

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

const RESEND_COOLDOWN_SECONDS = 60

export interface PhoneRegisterFormProps {
  onRegisterSuccess: (user: User) => void
}

export function PhoneRegisterForm({ onRegisterSuccess }: PhoneRegisterFormProps): JSX.Element {
  const [phone, setPhone] = React.useState('')
  const [code, setCode] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [confirmPassword, setConfirmPassword] = React.useState('')
  const [showPassword, setShowPassword] = React.useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = React.useState(false)
  const [loading, setLoading] = React.useState(false)
  const [sendingCode, setSendingCode] = React.useState(false)
  const [countdown, setCountdown] = React.useState(0)

  React.useEffect(() => {
    if (countdown <= 0) return
    const timer = window.setTimeout(() => setCountdown((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [countdown])

  const handleSendCode = React.useCallback(async () => {
    const normalizedPhone = phone.trim()
    if (!/^1[3-9]\d{9}$/.test(normalizedPhone)) { toast('请输入正确的手机号', 'error'); return }
    if (sendingCode || countdown > 0) return
    setSendingCode(true)
    try {
      await sendPhoneVerifyCode(normalizedPhone)
      toast('验证码已发送', 'success')
      setCountdown(RESEND_COOLDOWN_SECONDS)
    } catch (error) {
      console.error('Send sms code failed', error)
      toast(getErrorMessage(error, '验证码发送失败，请稍后再试'), 'error')
    } finally {
      setSendingCode(false)
    }
  }, [countdown, phone, sendingCode])

  const handleRegister = React.useCallback(async (event?: React.FormEvent) => {
    event?.preventDefault()
    const normalizedPhone = phone.trim()
    if (!/^1[3-9]\d{9}$/.test(normalizedPhone)) { toast('请输入正确的手机号', 'error'); return }
    if (!/^\d{6}$/.test(code.trim())) { toast('请输入 6 位验证码', 'error'); return }
    if (password.length < 6) { toast('密码长度至少 6 位', 'error'); return }
    if (password !== confirmPassword) { toast('两次输入的密码不一致', 'error'); return }
    if (loading) return
    setLoading(true)
    try {
      const { user } = await registerWithPhoneAndPassword(normalizedPhone, code.trim(), password)
      onRegisterSuccess(user)
    } catch (error) {
      console.error('Phone register failed', error)
      toast(getErrorMessage(error, '注册失败，请稍后再试'), 'error')
    } finally {
      setLoading(false)
    }
  }, [code, confirmPassword, loading, onRegisterSuccess, password, phone])

  return (
    <form className="tc-auth-form" onSubmit={(event) => void handleRegister(event)}>
      <div className="tc-auth-field">
        <label className="tc-auth-field__label" htmlFor="tc-register-phone">手机号</label>
        <input
          id="tc-register-phone"
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
        <label className="tc-auth-field__label" htmlFor="tc-register-code">验证码</label>
        <div className="tc-auth-code-row">
          <input
            id="tc-register-code"
            className="tc-auth-input tc-auth-code-input"
            type="text"
            inputMode="numeric"
            placeholder="6 位验证码"
            value={code}
            onChange={(event) => setCode(event.currentTarget.value.replace(/\D/g, ''))}
            maxLength={6}
            autoComplete="one-time-code"
          />
          <button
            type="button"
            className="tc-auth-send-code"
            disabled={sendingCode || countdown > 0 || !phone.trim()}
            onClick={() => void handleSendCode()}
          >
            {countdown > 0 ? `${countdown}s 后重发` : '获取验证码'}
          </button>
        </div>
      </div>

      <div className="tc-auth-field">
        <label className="tc-auth-field__label" htmlFor="tc-register-password">设置密码</label>
        <div className="tc-auth-password">
          <input
            id="tc-register-password"
            className="tc-auth-input tc-auth-input--password"
            type={showPassword ? 'text' : 'password'}
            placeholder="至少 6 位"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            autoComplete="new-password"
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

      <div className="tc-auth-field">
        <label className="tc-auth-field__label" htmlFor="tc-register-confirm">确认密码</label>
        <div className="tc-auth-password">
          <input
            id="tc-register-confirm"
            className="tc-auth-input tc-auth-input--password"
            type={showConfirmPassword ? 'text' : 'password'}
            placeholder="请再次输入密码"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.currentTarget.value)}
            autoComplete="new-password"
          />
          <button
            type="button"
            className="tc-auth-toggle"
            aria-label={showConfirmPassword ? '隐藏密码' : '显示密码'}
            title={showConfirmPassword ? '隐藏密码' : '显示密码'}
            onClick={() => setShowConfirmPassword((value) => !value)}
          >
            {showConfirmPassword ? <IconEyeOff size={15} /> : <IconEye size={15} />}
          </button>
        </div>
      </div>

      <button className="tc-auth-submit" type="submit" disabled={loading}>
        {loading ? '注册中...' : '创建账号'}
      </button>
    </form>
  )
}
