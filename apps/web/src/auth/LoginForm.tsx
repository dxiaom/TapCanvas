import React from 'react'
import { Anchor, Group, Stack, Tabs, Text } from '@mantine/core'
import { IconBrandGithub } from '@tabler/icons-react'
import { API_BASE, apiFetch } from '../api/server'
import { GITHUB_OAUTH_CALLBACK_PATH } from '../utils/appRoutes'
import { EmailCodeLoginForm } from './EmailCodeLoginForm'
import { WechatQrLoginForm } from './WechatQrLoginForm'
import { PasswordLoginForm } from './PasswordLoginForm'
import type { User } from './store'

const GUIDE_URL = 'https://ai.feishu.cn/wiki/YZWhw4w2FiO02LkqYosc4NY5nSh'

type ViteEnvShape = ImportMeta & { env?: { VITE_GITHUB_CLIENT_ID?: string } }
const GITHUB_CLIENT_ID = ((import.meta as ViteEnvShape).env?.VITE_GITHUB_CLIENT_ID || '').trim()

export interface LoginFormProps {
  /** Called after the server establishes the HttpOnly session cookie. */
  onLoginSuccess: (user: User) => void
  /** Whether to show the form's own heading. Set false when a parent modal provides its own title. Default: true */
  showTitle?: boolean
}

export function LoginForm({ onLoginSuccess, showTitle = true }: LoginFormProps): JSX.Element {
  const [wechatAvailable, setWechatAvailable] = React.useState<boolean | null>(null)

  // 探测微信扫码是否可用（后端未配置 WECHAT_OFFICIAL_* 时 available=false，隐藏 Tab）
  React.useEffect(() => {
    let alive = true
    void apiFetch(`${API_BASE}/auth/wechat-official/config`)
      .then(async (r) => {
        const body = (await r.json().catch(() => null)) as { available?: boolean } | null
        if (alive) setWechatAvailable(Boolean(r.ok && body?.available))
      })
      .catch(() => { if (alive) setWechatAvailable(false) })
    return () => { alive = false }
  }, [])

  const handleGithubLogin = React.useCallback(() => {
    if (!GITHUB_CLIENT_ID) return
    try {
      const callbackUrl = new URL(GITHUB_OAUTH_CALLBACK_PATH, window.location.origin).toString()
      const state = btoa(JSON.stringify({ redirect: window.location.pathname + window.location.search }))
      const authorizeUrl = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(GITHUB_CLIENT_ID)}&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${encodeURIComponent(state)}&scope=read:user`
      window.location.href = authorizeUrl
    } catch (error) {
      console.error('Build github authorize url failed', error)
    }
  }, [])

  return (
    <Stack className="tc-login-form" gap="md">
      {showTitle ? (
        <Stack className="tc-login-form__heading" gap={2}>
          <Text className="tc-login-form__title" fw={600} size="md" ta="center">登录 TapCanvas</Text>
          <Group className="tc-login-form__guide" justify="center" gap={6}>
            <Text className="tc-login-form__guide-label" size="xs" c="dimmed">不知道怎么用？</Text>
            <Anchor className="tc-login-form__guide-link" size="xs" href={GUIDE_URL} target="_blank" rel="noreferrer">查看使用指引</Anchor>
          </Group>
        </Stack>
      ) : null}

      <Tabs className="tc-login-form__tabs" defaultValue="email" keepMounted={false}>
        <Tabs.List className="tc-login-form__tab-list" justify="center">
          <Tabs.Tab className="tc-login-form__tab" value="email">验证码登录</Tabs.Tab>
          {wechatAvailable ? (
            <Tabs.Tab className="tc-login-form__tab" value="wechat">微信扫码</Tabs.Tab>
          ) : null}
        </Tabs.List>

        <Tabs.Panel className="tc-login-form__tab-panel" value="email" pt="sm">
          <EmailCodeLoginForm onLoginSuccess={onLoginSuccess} />
        </Tabs.Panel>
        {wechatAvailable ? (
          <Tabs.Panel className="tc-login-form__tab-panel" value="wechat" pt="sm">
            <WechatQrLoginForm active onLoginSuccess={onLoginSuccess} />
          </Tabs.Panel>
        ) : null}
      </Tabs>

      {GITHUB_CLIENT_ID ? (
        <Anchor
          className="tc-login-form__github"
          onClick={(event) => { event.preventDefault(); handleGithubLogin() }}
          aria-label="使用 GitHub 登录"
          style={{ display: 'flex', justifyContent: 'center' }}
        >
          <IconBrandGithub size={22} />
        </Anchor>
      ) : null}

      <PasswordLoginForm onLoginSuccess={onLoginSuccess} />
    </Stack>
  )
}
