// @vitest-environment jsdom
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRFStore } from '../canvas/store'
import { useUIStore } from './uiStore'
import FloatingNav from './FloatingNav'

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

// 测试环境语言可能是 en，标签需同时兼容中英文。
const CREATION_SHORTCUT_LABELS: readonly (readonly string[])[] = [
  ['文本', 'Text'],
  ['图像', 'Image'],
  ['分镜编辑'],
  ['分镜表'],
  ['导演台'],
  ['视频', 'Video'],
  ['音频', 'Audio'],
  ['视频分析'],
  ['视频合成'],
]

function shortcutButton(labels: readonly string[]): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`^(${labels.join('|')})$`) })
}

describe('FloatingNav creation node shortcuts', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({
      matches: false,
      media: '',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
    vi.stubGlobal('ResizeObserver', ResizeObserverStub)
    useUIStore.setState({ activePanel: null })
    useRFStore.getState().reset()
    vi.stubGlobal('crypto', { randomUUID: () => 'floating-nav-test-id' })
  })

  it('renders every creation node as a one-click toolbar shortcut', () => {
    render(<MantineProvider><FloatingNav /></MantineProvider>)

    for (const labels of CREATION_SHORTCUT_LABELS) {
      expect(shortcutButton(labels)).toBeInTheDocument()
    }
  })

  it('adds an image node directly from the toolbar without opening the add panel', () => {
    useUIStore.setState({ activePanel: 'add' })
    render(<MantineProvider><FloatingNav /></MantineProvider>)

    fireEvent.click(shortcutButton(['图像', 'Image']))

    const nodes = useRFStore.getState().nodes
    const imageNode = nodes.find((node) => (
      node.type === 'taskNode' && (node.data as { kind?: string }).kind === 'image'
    ))
    expect(imageNode).toBeDefined()
    expect(useUIStore.getState().activePanel).toBeNull()
  })

  it('adds a director console node from the toolbar', () => {
    render(<MantineProvider><FloatingNav /></MantineProvider>)

    fireEvent.click(shortcutButton(['导演台']))

    expect(useRFStore.getState().nodes.some((node) => node.type === 'directorConsole')).toBe(true)
  })

  it('toggles the orchestration node panel from the AI orchestration toolbar item', () => {
    render(<MantineProvider><FloatingNav /></MantineProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'AI 编排' }))
    expect(useUIStore.getState().activePanel).toBe('add')

    fireEvent.click(screen.getByRole('button', { name: 'AI 编排' }))
    expect(useUIStore.getState().activePanel).toBeNull()
  })

  it('renders vertically when the toolbar is docked to a canvas side', () => {
    useUIStore.setState({ canvasToolbarPosition: 'left' })
    const { container } = render(<MantineProvider><FloatingNav /></MantineProvider>)

    const bar = container.querySelector<HTMLElement>('.floating-nav')
    expect(bar?.classList.contains('floating-nav--side')).toBe(true)
    expect(bar?.style.top).toBe('50%')
  })
})
