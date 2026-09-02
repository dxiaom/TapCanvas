import React from 'react'
import { Button, PasswordInput, Stack, Text, TextInput } from '@mantine/core'
import { loginWithCredentials } from '../api/server'
import { toast } from '../ui/toast'
import { DEFAULT_PLATFORM_CREDENTIALS } from './defaultCredentials'
import type { User } from './store'

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export interface PasswordLoginFormProps {
  onLoginSuccess: (user: User) => void
}

export function PasswordLoginForm({ onLoginSuccess }: PasswordLoginFormProps): JSX.Element {
  const [username, setUsername] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [loading, setLoading] = React.useState(false)

  const handleLogin = React.useCallback(async () => {
    const normalizedUsername = username.trim()
    if (!normalizedUsername) { toast('请输入账号', 'error'); return }
    if (!password) { toast('请输入密码', 'error'); return }
    if (loading) return
    setLoading(true)
    try {
      const { user } = await loginWithCredentials(normalizedUsername, password)
      onLoginSuccess(user)
    } catch (error) {
      console.error('Credential login failed', error)
      toast(getErrorMessage(error, '账号密码登录失败，请稍后再试'), 'error')
    } finally {
      setLoading(false)
    }
  }, [loading, onLoginSuccess, password, username])

  return (
    <details className="tc-login-form__password-collapse">
      <summary className="tc-login-form__password-summary">账号密码登录</summary>
      <Stack className="tc-login-form__credentials" gap="sm" pt="sm">
        {import.meta.env.DEV ? (
          <div className="tc-login-form__default-credentials">
            <Text className="tc-login-form__default-credentials-title" size="xs" fw={650}>
              本地默认登录账号
            </Text>
            <div className="tc-login-form__default-credentials-list">
              {DEFAULT_PLATFORM_CREDENTIALS.map((credential) => (
                <div className="tc-login-form__default-credential" key={credential.platform}>
                  <span className="tc-login-form__default-credential-platform">{credential.platform}</span>
                  <code className="tc-login-form__default-credential-value">
                    {credential.username} / {credential.password}
                  </code>
                </div>
              ))}
            </div>
            <Text className="tc-login-form__default-credentials-note" size="xs" c="dimmed">
              仅适用于未覆盖部署变量的首次启动；生产环境请立即修改默认密码。
            </Text>
          </div>
        ) : null}

        <TextInput
          className="tc-login-form__username-input"
          label="账号"
          placeholder="请输入账号"
          value={username}
          onChange={(event) => setUsername(event.currentTarget.value)}
          autoComplete="username"
        />
        <PasswordInput
          className="tc-login-form__password-input"
          label="密码"
          placeholder="请输入密码"
          value={password}
          onChange={(event) => setPassword(event.currentTarget.value)}
          autoComplete="current-password"
          onKeyDown={(event) => { if (event.key === 'Enter') void handleLogin() }}
        />
        <Button
          className="tc-login-form__submit"
          color="blue"
          fullWidth
          loading={loading}
          disabled={!username.trim() || !password || loading}
          onClick={() => void handleLogin()}
        >
          登录
        </Button>
      </Stack>
    </details>
  )
}
