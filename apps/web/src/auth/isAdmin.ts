import { useAuth } from './store'

const viteEnv: Readonly<{ VITE_DEV_ALL_ADMIN?: string; DEV?: boolean }> = import.meta.env

// 管理员判定只认真实 role；开发期需要放开时必须显式设置 VITE_DEV_ALL_ADMIN=1，
// 禁止以 DEV 构建模式作为隐式放行条件（零隐式兜底原则）。
export function isDevAllAdminEnabled(): boolean {
  const raw = viteEnv.VITE_DEV_ALL_ADMIN
  if (typeof raw === 'string' && raw.trim()) {
    const v = raw.trim().toLowerCase()
    return v === '1' || v === 'true' || v === 'yes' || v === 'on'
  }
  return false
}

export function useIsAdmin(): boolean {
  const role = useAuth((s) => s.user?.role || null)
  return isDevAllAdminEnabled() || role === 'admin'
}

export function isCurrentUserAdmin(): boolean {
  return isDevAllAdminEnabled() || useAuth.getState().user?.role === 'admin'
}
