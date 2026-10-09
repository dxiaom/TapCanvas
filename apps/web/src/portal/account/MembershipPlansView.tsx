import React from 'react'
import { Button, Group, SegmentedControl, Text } from '@mantine/core'
import type { AccountOverview } from '../accountApi'
import type { AccountMembershipCurrent } from './AccountCreditsView'
import { MembershipScanModal } from './MembershipScanModal'
import { useMembershipPurchase } from './useMembershipPurchase'
import {
  buildMembershipPlanCards,
  classifyMembershipPurchase,
  formatMembershipDiscount,
  hasMembershipDailyGift,
  type MembershipBillingCycle,
  type MembershipPlanCard,
  type MembershipPlanVariant,
} from './membershipPlanViewModel'
import { toast } from '../../ui/toast'
import './account-center.css'

function currentPlanKind(current: AccountMembershipCurrent, card: MembershipPlanCard, variant: MembershipPlanVariant): 'renew' | 'upgrade' | 'downgrade' | 'open' {
  const snapshot = {
    planCode: current.planCode,
    monthlyCredits: current.monthlyCredits,
    dailyGiftCredits: current.dailyGiftCredits,
  }
  return classifyMembershipPurchase(snapshot, card, variant)
}

function PlanCard({ card, cycle, current, busy, onPurchase }: {
  card: MembershipPlanCard
  cycle: MembershipBillingCycle
  current: AccountMembershipCurrent | null
  busy: boolean
  onPurchase: (card: MembershipPlanCard, variant: MembershipPlanVariant) => void
}): JSX.Element {
  const variants = card.variants.filter((variant) => variant.billingCycle === cycle)
  const featured = card.featured
  return (
    <article className={`membership-plan-card${featured ? ' is-featured' : ''}`}>
      <div className="membership-plan-card__head">
        <strong className="membership-plan-card__title">{card.product.title}</strong>
        {card.badge ? <span className="membership-plan-card__badge">{card.badge}</span> : null}
      </div>
      <div className="membership-plan-card__summary">{card.campaignBenefits[0] || ''}</div>
      <div className="membership-plan-card__variants">
        {variants.map((variant) => {
          const kind = current ? currentPlanKind(current, card, variant) : 'open'
          const discount = formatMembershipDiscount(variant.priceCents, variant.compareAtPriceCents)
          const label = variant.name || (variant.billingCycle === 'annual' ? '年付' : '月付')
          return (
            <div className="membership-plan-card__variant" key={variant.sku?.id ?? variant.billingCycle}>
              <div className="membership-plan-card__variant-row">
                <span className="membership-plan-card__variant-name">{label}</span>
                <div className="membership-plan-card__variant-price">
                  <strong className="membership-plan-card__price">¥{PRICE_GROUPED.format(Math.max(0, variant.priceCents) / 100)}</strong>
                  {variant.compareAtPriceCents && variant.compareAtPriceCents > variant.priceCents
                    ? <s className="membership-plan-card__compare-price">¥{PRICE_GROUPED.format(Math.max(0, variant.compareAtPriceCents) / 100)}</s>
                    : null}
                  {discount ? <span className="membership-plan-card__discount">{discount}</span> : null}
                </div>
              </div>
              <div className="membership-plan-card__variant-meta">
                {variant.capacityLabel
                  ? <span>动态算力 {variant.capacityLabel}</span>
                  : <span>每月 {variant.monthlyCredits.toLocaleString('zh-CN')} 积分</span>}
                {hasMembershipDailyGift(variant.dailyGiftCredits)
                  ? <span>每日赠送 {variant.dailyGiftCredits.toLocaleString('zh-CN')}</span>
                  : null}
              </div>
              <Button
                className="membership-plan-card__buy"
                size="compact-sm"
                variant={featured ? 'filled' : 'light'}
                loading={busy}
                onClick={() => onPurchase(card, variant)}
              >
                {kind === 'open' ? '立即开通' : kind === 'renew' ? '续费' : kind === 'upgrade' ? '升级' : '变更'}
              </Button>
            </div>
          )
        })}
      </div>
      <ul className="membership-plan-card__features">
        {card.features.map((feature) => <li key={feature}>{feature}</li>)}
      </ul>
    </article>
  )
}

const PRICE_GROUPED = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 })

export function MembershipPlansView({ overview, onPurchased }: {
  overview: AccountOverview | null
  onPurchased: () => Promise<void>
}): JSX.Element {
  const [cycle, setCycle] = React.useState<MembershipBillingCycle>('monthly')
  const { busy, phase, qrDataUrl, purchase, switchPayMethod, closeScanModal } = useMembershipPurchase(onPurchased)

  const current = overview?.membership.current ?? null
  const plans = overview?.membership.plans ?? []
  const annualAvailable = React.useMemo(
    () => buildMembershipPlanCards(plans, 'annual').cards.length > 0,
    [plans],
  )
  const effectiveCycle: MembershipBillingCycle = annualAvailable ? cycle : 'monthly'
  const cardsResult = React.useMemo(() => buildMembershipPlanCards(plans, effectiveCycle), [plans, effectiveCycle])

  const handlePurchase = React.useCallback((card: MembershipPlanCard, variant: MembershipPlanVariant) => {
    if (!variant.sku) {
      toast('该套餐暂无可购规格', 'error')
      return
    }
    void purchase({ productId: card.product.id, skuId: variant.sku.id, priceCents: variant.priceCents })
  }, [purchase])

  if (!overview?.membership.enabled || plans.length === 0) {
    return (
      <div className="membership-plans-view">
        <div className="account-center-state"><span className="account-center-state__message">会员套餐暂未开放，敬请期待</span></div>
      </div>
    )
  }

  return (
    <div className="membership-plans-view">
      {current ? (
        <div className="membership-current-banner">
          <span className="membership-current-banner__label">当前套餐</span>
          <strong className="membership-current-banner__plan">{current.planName}</strong>
          <span className="membership-current-banner__validity">有效至 {new Date(current.endAt).toLocaleDateString('zh-CN')}</span>
        </div>
      ) : null}
      {annualAvailable ? (
        <Group className="membership-cycle-switch" justify="flex-end" gap="xs">
          <SegmentedControl
            size="xs"
            value={cycle}
            onChange={(value: string) => setCycle(value === 'annual' ? 'annual' : 'monthly')}
            data={[
              { label: '月付', value: 'monthly' },
              { label: '年付', value: 'annual' },
            ]}
          />
        </Group>
      ) : null}
      {cardsResult.errors.length > 0 ? (
        <div className="membership-plan-errors">
          {cardsResult.errors.map((message) => <Text className="membership-plan-errors__item" key={message} size="xs" c="red">{message}</Text>)}
        </div>
      ) : null}
      <div className="membership-plan-grid">
        {cardsResult.cards.map((card) => (
          <PlanCard
            card={card}
            cycle={effectiveCycle}
            current={current}
            busy={busy}
            onPurchase={handlePurchase}
            key={card.product.id}
          />
        ))}
      </div>
      <MembershipScanModal phase={phase} qrDataUrl={qrDataUrl} onClose={closeScanModal} onSwitchMethod={(method) => void switchPayMethod(method)} />
    </div>
  )
}
