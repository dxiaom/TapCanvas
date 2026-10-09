import React from 'react'
import { SegmentedControl } from '@mantine/core'
import type { CommerceProductDto } from '../api/server'
import { apiFetch, API_BASE } from '../api/server'
import { useAuth } from '../auth/store'
import { getAccountOverview, type AccountOverview } from './accountApi'
import {
  buildMembershipPlanCards,
  hasMembershipDailyGift,
  type MembershipBillingCycle,
  type MembershipPlanCard,
  type MembershipPlanVariant,
} from './account/membershipPlanViewModel'
import { MembershipScanModal } from './account/MembershipScanModal'
import { useMembershipPurchase } from './account/useMembershipPurchase'
import { PricingPlanCard } from './PricingPlanCard'
import { PortalHeader } from './PortalHeader'
import { PortalFooter } from './PortalFooter'
import { toast } from '../ui/toast'
import './portal.css'
import './PricingPage.css'

const PortalLoginRuntime = React.lazy(() => import('./PortalLoginRuntime'))

export default function PricingPage(): JSX.Element {
  const auth = useAuth()
  const [cycle, setCycle] = React.useState<MembershipBillingCycle>('annual')
  const [loginOpen, setLoginOpen] = React.useState(false)
  const [plans, setPlans] = React.useState<CommerceProductDto[] | null>(null)
  const [overview, setOverview] = React.useState<AccountOverview | null>(null)

  React.useEffect(() => {
    let active = true
    void apiFetch(`${API_BASE}/public/membership/plans`)
      .then(async (response) => {
        if (!active) return
        if (!response.ok) {
          setPlans(null)
          return
        }
        const body: unknown = await response.json().catch(() => null)
        const items = body && typeof body === 'object' && !Array.isArray(body)
          ? (body as { items?: unknown }).items
          : null
        setPlans(Array.isArray(items) ? items as CommerceProductDto[] : null)
      })
      .catch(() => { if (active) setPlans(null) })
    return () => { active = false }
  }, [])

  const refreshOverview = React.useCallback(async () => {
    try {
      setOverview(await getAccountOverview())
    } catch (reason: unknown) {
      console.warn('[pricing] account overview failed', reason)
      setOverview(null)
    }
  }, [])

  React.useEffect(() => {
    if (!auth.token) {
      setOverview(null)
      return
    }
    void refreshOverview()
  }, [auth.token, refreshOverview])

  const { busy, phase, qrDataUrl, purchase, switchPayMethod, closeScanModal } = useMembershipPurchase(refreshOverview)

  const annualAvailable = React.useMemo(
    () => buildMembershipPlanCards(plans ?? [], 'annual').cards.length > 0,
    [plans],
  )
  const effectiveCycle: MembershipBillingCycle = annualAvailable ? cycle : 'monthly'
  const cards = React.useMemo(
    () => buildMembershipPlanCards(plans ?? [], effectiveCycle).cards,
    [plans, effectiveCycle],
  )
  const hasDailyGift = cards.some((card) => card.variants.some((variant) => hasMembershipDailyGift(variant.dailyGiftCredits)))

  const current = overview?.membership.current ?? null

  const handlePurchase = React.useCallback((card: MembershipPlanCard, variant: MembershipPlanVariant) => {
    if (!auth.token) {
      setLoginOpen(true)
      return
    }
    if (!variant.sku) {
      toast('该套餐暂无可购规格', 'error')
      return
    }
    void purchase({ productId: card.product.id, skuId: variant.sku.id, priceCents: variant.priceCents })
  }, [auth.token, purchase])

  return (
    <div className="neo-pricing">
      <PortalHeader
        active="pricing"
        onRequestLogin={() => setLoginOpen(true)}
      />
      <div className="tc-portal-scroll-area">
        <main className="neo-pricing__main">
          <span className="pricing-kicker">Pricing</span>
          <h1 className="pricing-title">选择你的创作套餐</h1>
          <p className="pricing-subtitle">开通即得本月积分{hasDailyGift ? '，会员期内每日赠送积分，当日有效' : ''}。</p>
          {annualAvailable ? (
            <div className="pricing-cycle-switch">
              <SegmentedControl
                size="md"
                value={cycle}
                onChange={(value: string) => setCycle(value === 'annual' ? 'annual' : 'monthly')}
                data={[
                  { label: '年付', value: 'annual' },
                  { label: '月付', value: 'monthly' },
                ]}
              />
            </div>
          ) : null}
          {cards.length > 0 ? (
            <div className="pricing-grid">
              {cards.map((card) => (
                <PricingPlanCard
                  card={card}
                  current={current}
                  busy={busy}
                  onPurchase={handlePurchase}
                  key={`${card.product.id}:${effectiveCycle}`}
                />
              ))}
            </div>
          ) : (
            <div className="neo-pricing__empty">套餐暂未开放，敬请期待</div>
          )}
        </main>
        <PortalFooter />
      </div>
      <MembershipScanModal phase={phase} qrDataUrl={qrDataUrl} onClose={closeScanModal} onSwitchMethod={(method) => void switchPayMethod(method)} />
      {loginOpen ? (
        <React.Suspense fallback={null}>
          <PortalLoginRuntime opened={loginOpen} onClose={() => setLoginOpen(false)} />
        </React.Suspense>
      ) : null}
    </div>
  )
}
