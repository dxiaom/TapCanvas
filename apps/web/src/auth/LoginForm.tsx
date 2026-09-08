import React from 'react'
import { PhoneLoginForm } from './PhoneLoginForm'
import { PhoneRegisterForm } from './PhoneRegisterForm'
import type { User } from './store'

type LoginTabMode = 'login' | 'register'

export interface LoginFormProps {
  /** Called after the server establishes the HttpOnly session cookie. */
  onLoginSuccess: (user: User) => void
  /** Whether to show the form's own heading. Set false when a parent modal provides its own title. Default: true */
  showTitle?: boolean
}

export function LoginForm({ onLoginSuccess, showTitle = true }: LoginFormProps): JSX.Element {
  const [mode, setMode] = React.useState<LoginTabMode>('login')

  const tabs: Array<{ key: LoginTabMode; label: string }> = [
    { key: 'login', label: '登录' },
    { key: 'register', label: '注册' },
  ]

  return (
    <div className="tc-login-form">
      {showTitle ? (
        <div className="tc-login-form__heading">
          <p className="tc-login-form__title">登录 TapCanvas</p>
        </div>
      ) : null}

      <div className="tc-login-form__tab-switch" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={mode === tab.key}
            className={`tc-login-form__tab-btn${mode === tab.key ? ' tc-login-form__tab-btn--active' : ''}`}
            onClick={() => setMode(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="tc-login-form__panel" key={mode}>
        {mode === 'login' ? (
          <PhoneLoginForm onLoginSuccess={onLoginSuccess} />
        ) : (
          <PhoneRegisterForm onRegisterSuccess={onLoginSuccess} />
        )}
      </div>
    </div>
  )
}
