import React from 'react'
import { Image, Loader, Stack, Text } from '@mantine/core'
import {
  consumeWechatLoginSession,
  createWechatLoginSession,
  getWechatLoginStatus,
  WechatLoginDisabledError,
} from '../api/server'
import { toast } from '../ui/toast'
import type { User } from './store'

const POLL_INTERVAL_MS = 1500

export interface WechatQrLoginFormProps {
  active: boolean
  onLoginSuccess: (user: User) => void
}

export function WechatQrLoginForm({ active, onLoginSuccess }: WechatQrLoginFormProps): JSX.Element {
  const [qr, setQr] = React.useState<{ sessionId: string; qrCodeUrl: string } | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [statusText, setStatusText] = React.useState('正在生成二维码…')

  React.useEffect(() => {
    if (!active) return
    let alive = true
    let timer: number | null = null
    void (async () => {
      try {
        const session = await createWechatLoginSession()
        if (!alive) return
        setQr({ sessionId: session.sessionId, qrCodeUrl: session.qrCodeUrl })
        setStatusText('请用微信扫码')
        timer = window.setInterval(() => {
          void (async () => {
            try {
              const status = await getWechatLoginStatus(session.sessionId)
              if (!alive) return
              if (status.status === 'authorized') {
                if (timer !== null) window.clearInterval(timer)
                setStatusText('已确认，正在登录…')
                try {
                  const { user } = await consumeWechatLoginSession(session.sessionId)
                  if (!alive) return
                  onLoginSuccess(user)
                } catch (consumeError) {
                  console.error('Consume wechat session failed', consumeError)
                  toast('微信登录失败，请重试', 'error')
                  setStatusText('登录失败，请切换 Tab 重试')
                }
              } else if (status.status === 'expired') {
                if (timer !== null) window.clearInterval(timer)
                setStatusText('二维码已过期，请切换 Tab 重新进入')
              } else if (status.status === 'unlinked') {
                setStatusText('该微信尚未绑定账号，请先用邮箱验证码登录')
              }
            } catch (pollError) {
              console.error('Wechat login poll failed', pollError)
            }
          })()
        }, POLL_INTERVAL_MS)
      } catch (createError) {
        if (createError instanceof WechatLoginDisabledError) {
          setError('微信扫码登录未开启')
        } else {
          console.error('Create wechat session failed', createError)
          setError('二维码生成失败，请稍后再试')
        }
      }
    })()
    return () => {
      alive = false
      if (timer !== null) window.clearInterval(timer)
    }
  }, [active, onLoginSuccess])

  return (
    <Stack className="tc-wechat-login" align="center" gap="sm">
      {qr ? (
        <Image className="tc-wechat-login__qr" src={qr.qrCodeUrl} alt="微信扫码登录二维码" w={200} h={200} fit="contain" />
      ) : (
        <Stack className="tc-wechat-login__placeholder" align="center" gap="xs" h={200} justify="center">
          {error ? <Text className="tc-wechat-login__error" size="sm" c="red">{error}</Text> : <Loader size="sm" />}
        </Stack>
      )}
      <Text className="tc-wechat-login__status" size="sm" c="dimmed">{statusText}</Text>
    </Stack>
  )
}
