// 全屏登录覆盖层（对齐 MirrorFrame Tauri 客户端布局）：
// 全屏视频背景 + 左侧品牌展示区 + 右侧液态玻璃登录面板。
import React from 'react'
import ReactDOM from 'react-dom'
import { ActionIcon } from '@mantine/core'
import { IconX } from '@tabler/icons-react'
import {
  clearPendingRefCode,
  fetchHomepageDecoration,
  type HomepageDecoration,
  type LoginVideoItem,
} from '../api/server'
import { TapCanvasMark } from '../ui/brand/TapCanvasMark'
import { LoginForm } from './LoginForm'
import { useAuth } from './store'
import './loginOverlay.css'

// 装修数据模块级缓存：多次打开登录层不重复请求
let decorationPromise: Promise<HomepageDecoration> | null = null
function getDecoration(): Promise<HomepageDecoration> {
  if (!decorationPromise) decorationPromise = fetchHomepageDecoration()
  return decorationPromise
}

// 登录背景视频完全由装修接口（/assets/homepage-decoration 的 loginVideos）配置。
// 视频加载超时：Tauri/WebView 或网络异常时 error 事件可能不触发，必须靠超时切换
const VIDEO_LOAD_TIMEOUT_MS = 5000

function LoginVideoPane({ videos }: { videos: LoginVideoItem[] }): JSX.Element {
  const [index, setIndex] = React.useState(0)
  const videoRef = React.useRef<HTMLVideoElement | null>(null)
  const active = videos[index] ?? null
  const single = videos.length <= 1

  const nextIndex = React.useCallback(() => {
    if (single) return
    let next = Math.floor(Math.random() * videos.length)
    if (videos.length > 1) {
      let attempts = 0
      while (next === index && attempts < 10) {
        next = Math.floor(Math.random() * videos.length)
        attempts++
      }
    }
    setIndex(next)
  }, [index, single, videos.length])

  // 加载超时兜底：5 秒内未开始播放则切换下一个源
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      const el = videoRef.current
      if (el && el.readyState < 2) nextIndex()
    }, VIDEO_LOAD_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [index, nextIndex])

  return (
    <div className="tc-login__stage">
      {active ? (
        <video
          key={active.url}
          ref={videoRef}
          className="tc-login__video"
          src={active.url}
          poster={active.posterUrl || undefined}
          autoPlay
          muted
          playsInline
          preload="metadata"
          loop={single}
          onEnded={() => { if (!single) nextIndex() }}
          onError={() => { if (!single) nextIndex() }}
        />
      ) : (
        <div className="tc-login__fallback" />
      )}
      <div className="tc-login__stage-shade" />
      {active?.caption ? (
        <div className="tc-login__caption">{active.caption}</div>
      ) : null}
      {videos.length > 1 ? (
        <div className="tc-login__dots" role="tablist">
          {videos.map((v, i) => (
            <button
              key={v.url + i}
              className={`tc-login__dot${i === index ? ' tc-login__dot--active' : ''}`}
              aria-label={`第 ${i + 1} 条视频`}
              onClick={() => setIndex(i)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function BrandStage(): JSX.Element {
  return (
    <div className="tc-login__brand-stage">
      <div className="tc-login__brand-stage-inner">
        <div className="tc-login__brand-stage-logo">
          <TapCanvasMark className="tc-login__brand-stage-logo-img" size={52} alt="" />
        </div>
        <h1 className="tc-login__brand-stage-title">TapCanvas</h1>
        <p className="tc-login__brand-stage-en">AI Creation Canvas</p>
        <p className="tc-login__brand-stage-slogan">AI 创作 · 释放你的创作潜能</p>

        <ul className="tc-login__brand-features">
          <li>
            <span className="tc-login__feature-dot" />
            <span className="tc-login__feature-text">AI 图像生成 · 文本一键成画</span>
          </li>
          <li>
            <span className="tc-login__feature-dot" />
            <span className="tc-login__feature-text">视频制作 · 分镜驱动智能成片</span>
          </li>
          <li>
            <span className="tc-login__feature-dot" />
            <span className="tc-login__feature-text">小说编辑 · 剧本分镜一体化</span>
          </li>
          <li>
            <span className="tc-login__feature-dot" />
            <span className="tc-login__feature-text">资产矩阵 · 角色/场景/道具全管理</span>
          </li>
        </ul>

        <div className="tc-login__brand-footer">
          <span>© 2026 TapCanvas</span>
        </div>
      </div>
    </div>
  )
}

export interface LoginOverlayProps {
  opened: boolean
  onClose: () => void
}

export function LoginOverlay({ opened, onClose }: LoginOverlayProps): JSX.Element | null {
	const setAuth = useAuth((s) => s.setAuth)
	const [videos, setVideos] = React.useState<LoginVideoItem[]>([])

  React.useEffect(() => {
    if (!opened) return
    let alive = true
    void getDecoration().then((d) => { if (alive) setVideos(d.loginVideos) })
    return () => { alive = false }
  }, [opened])

  React.useEffect(() => {
    if (!opened) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [opened, onClose])

  const handleLoginSuccess = React.useCallback(
		(user: Parameters<typeof setAuth>[0]) => {
			setAuth(user)
			clearPendingRefCode()
			onClose()
    },
    [setAuth, onClose],
  )

  if (!opened) return null

  return ReactDOM.createPortal(
    <div className="tc-login" role="dialog" aria-modal="true" aria-label="登录 TapCanvas">
      <LoginVideoPane videos={videos} />

      <BrandStage />

      <div className="tc-login__glass-panel">
        <ActionIcon
          className="tc-login__close"
          style={{ position: 'absolute', top: 20, right: 20, zIndex: 2 }}
          variant="subtle"
          color="gray"
          size="lg"
          radius="xl"
          aria-label="关闭"
          onClick={onClose}
        >
          <IconX size={18} />
        </ActionIcon>

        <div className="tc-login__card">
          <div className="tc-login__brand">
            <div className="tc-login__brand-icon">
              <TapCanvasMark className="tc-login__brand-logo-img" size={32} alt="" />
            </div>
            <p className="tc-login__brand-desc">欢迎登录</p>
            <p className="tc-login__brand-subtitle">继续你的创作之旅</p>
          </div>

          <LoginForm onLoginSuccess={handleLoginSuccess} showTitle={false} />

          <p className="tc-login__agreement">
            登录或注册即代表同意 TapCanvas 平台用户协议与隐私政策
          </p>
        </div>
      </div>
    </div>,
    document.body,
  )
}
