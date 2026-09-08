// @vitest-environment jsdom

import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoginForm } from './LoginForm'

const { loginWithCredentials } = vi.hoisted(() => ({
  loginWithCredentials: vi.fn(),
}))

vi.mock('../api/server', () => ({ loginWithCredentials }))

describe('LoginForm', () => {
  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('logs in with phone and password without exposing SMS controls on login tab', async () => {
    const onLoginSuccess = vi.fn()
    loginWithCredentials.mockResolvedValue({
      authenticated: true,
      user: { sub: 'phone_user_1', login: '13800138000', role: null },
    })
    render(<LoginForm onLoginSuccess={onLoginSuccess} />)

    expect(screen.getByRole('tab', { name: '登录' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: '注册' })).toBeTruthy()
    expect(screen.queryByText('获取验证码')).toBeNull()

    fireEvent.change(screen.getByLabelText('手机号'), { target: { value: '13800138000' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: '开始你的创作' }))

    await waitFor(() =>
      expect(loginWithCredentials).toHaveBeenCalledWith('13800138000', '123456'),
    )
    expect(onLoginSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ login: '13800138000' }),
    )
  })
})
