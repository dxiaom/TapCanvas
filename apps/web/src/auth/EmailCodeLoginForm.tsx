import React from 'react'
import { Button, Group, Stack, Text, TextInput } from '@mantine/core'
import { requestEmailLoginCode, verifyEmailLogin } from '../api/server'
import { toast } from '../ui/toast'
import type { User } from './store'

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export interface EmailCodeLoginFormProps {
  onLoginSuccess: (user: User) => void
}

export function EmailCodeLoginForm({ onLoginSuccess }: EmailCodeLoginFormProps): JSX.Element {
  const [email, setEmail] = React.useState('')
  const [code, setCode] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [countdown, setCountdown] = React.useState(0)

  React.useEffect(() => {
    if (countdown <= 0) return
    const timer = window.setInterval(() => setCountdown((v) => Math.max(0, v - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [countdown])

  const handleSend = React.useCallback(async () => {
    const normalizedEmail = email.trim().toLowerCase()
    if (!EMAIL_FORMAT.test(normalizedEmail)) { toast('请输入正确的邮箱地址', 'error'); return }
    if (sending || countdown > 0) return
    setSending(true)
    try {
      const result = await requestEmailLoginCode(normalizedEmail)
      setCountdown(60)
      // 后端仅在 localhost/调试模式下返回 devCode（未配置邮件服务时）；生产环境永远不会有该字段
      if (result.devCode) {
        toast(`本地开发验证码：${result.devCode}`, 'success')
      } else {
        toast(result.expiresInSeconds ? `验证码已发送，${Math.round(result.expiresInSeconds / 60)} 分钟内有效` : '验证码已发送', 'success')
      }
    } catch (error) {
      console.error('Send email code failed', error)
      toast(getErrorMessage(error, '验证码发送失败，请稍后再试'), 'error')
    } finally {
      setSending(false)
    }
  }, [countdown, email, sending])

  const handleSubmit = React.useCallback(async () => {
    const normalizedEmail = email.trim().toLowerCase()
    if (!EMAIL_FORMAT.test(normalizedEmail)) { toast('请输入正确的邮箱地址', 'error'); return }
    if (!/^\d{6}$/.test(code.trim())) { toast('请输入 6 位验证码', 'error'); return }
    if (submitting) return
    setSubmitting(true)
    try {
      const { user } = await verifyEmailLogin(normalizedEmail, code.trim())
      onLoginSuccess(user)
    } catch (error) {
      console.error('Email code login failed', error)
      toast(getErrorMessage(error, '验证码登录失败，请稍后再试'), 'error')
    } finally {
      setSubmitting(false)
    }
  }, [code, email, onLoginSuccess, submitting])

  return (
    <Stack className="tc-email-login" gap="sm">
      <TextInput
        className="tc-email-login__email"
        label="邮箱"
        placeholder="you@example.com"
        value={email}
        onChange={(event) => setEmail(event.currentTarget.value)}
        autoComplete="email"
      />
      <Group className="tc-email-login__code-row" gap="sm" align="flex-end" wrap="nowrap">
        <TextInput
          className="tc-email-login__code"
          label="验证码"
          placeholder="6 位数字"
          value={code}
          onChange={(event) => setCode(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void handleSubmit() }}
          autoComplete="one-time-code"
          style={{ flex: 1 }}
        />
        <Button
          className="tc-email-login__send"
          variant="light"
          disabled={sending || countdown > 0 || !EMAIL_FORMAT.test(email.trim().toLowerCase())}
          loading={sending}
          onClick={() => void handleSend()}
        >
          {countdown > 0 ? `${countdown}s 后重发` : '发送验证码'}
        </Button>
      </Group>
      <Button
        className="tc-email-login__submit"
        fullWidth
        loading={submitting}
        disabled={!EMAIL_FORMAT.test(email.trim().toLowerCase()) || !/^\d{6}$/.test(code.trim())}
        onClick={() => void handleSubmit()}
      >
        登录 / 注册
      </Button>
      <Text className="tc-email-login__hint" size="xs" c="dimmed" ta="center">
        未注册的邮箱将自动创建账号
      </Text>
    </Stack>
  )
}
