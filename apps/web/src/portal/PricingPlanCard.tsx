import React from 'react'
import { Slider } from '@mantine/core'
import type { AccountMembershipCurrent } from './account/AccountCreditsView'
import {
  classifyMembershipPurchase,
  formatMembershipDiscount,
  hasMembershipDailyGift,
  membershipPlanSummary,
  type MembershipPlanCard,
  type MembershipPlanVariant,
} from './account/membershipPlanViewModel'

const PRICE_FIXED = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const PRICE_GROUPED = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 })

function formatMainPrice(priceCents: number): string {
  return PRICE_GROUPED.format(Math.max(0, priceCents) / 100)
}

function formatPerMonthPrice(priceCents: number): string {
  return PRICE_FIXED.format(Math.max(0, priceCents) / 1200)
}

function purchaseLabel(kind: 'open' | 'renew' | 'upgrade' | 'downgrade'): string {
  if (kind === 'renew') return '续费'
  if (kind === 'upgrade') return '升级到'
  if (kind === 'downgrade') return '变更到'
  return '立即开通'
}

export function PricingPlanCard({ card, current, busy, onPurchase }: {
  card: MembershipPlanCard
  current: AccountMembershipCurrent | null
  busy: boolean
  onPurchase: (card: MembershipPlanCard, variant: MembershipPlanVariant) => void
}): JSX.Element | null {
  const variants = card.variants
  const [index, setIndex] = React.useState(0)
  if (variants.length === 0) return null
  const variant = variants[Math.min(index, variants.length - 1)]
  if (!variant) return null

  const annual = variant.billingCycle === 'annual'
  const featured = card.featured
  const multiVariant = variants.length > 1
  const kind = current
    ? classifyMembershipPurchase(
      {
        planCode: current.planCode,
        monthlyCredits: current.monthlyCredits,
        dailyGiftCredits: current.dailyGiftCredits,
      },
      card,
      variant,
    )
    : 'open'
  const discount = formatMembershipDiscount(variant.priceCents, variant.compareAtPriceCents)
  const hasComparePrice = Boolean(variant.compareAtPriceCents && variant.compareAtPriceCents > variant.priceCents)

  return (
    <article className={`pricing-card${featured ? ' pricing-card--featured' : ''}`}>
      {featured ? <div className="pricing-card__ribbon">✦ 推荐创作者使用</div> : null}
      <div className="pricing-card__head">
        <strong className="pricing-card__title">{card.product.title}</strong>
        <span className="pricing-card__cycle">{annual ? '每年' : '每月'}</span>
      </div>
      <div className="pricing-card__price">
        <span className="pricing-card__price-symbol">¥</span>
        <strong className="pricing-card__price-value">{formatMainPrice(variant.priceCents)}</strong>
        <span className="pricing-card__price-unit">{annual ? '/年' : '/月'}</span>
      </div>
      <div className="pricing-card__price-sub">
        {annual ? <span>¥{formatPerMonthPrice(variant.priceCents)}/月</span> : null}
        {hasComparePrice ? <s>¥{formatMainPrice(variant.compareAtPriceCents ?? 0)}</s> : null}
        {discount ? <span className="pricing-card__discount">{discount}</span> : null}
      </div>
      <p className="pricing-card__summary">{membershipPlanSummary(card, variant)}</p>
      {multiVariant ? (
        <div className="pricing-card__slider">
          <Slider
            value={Math.min(index, variants.length - 1)}
            onChange={(value: number) => setIndex(value)}
            min={0}
            max={variants.length - 1}
            step={1}
            marks={variants.map((item, i) => ({ value: i, label: item.capacityLabel || String(i + 1) }))}
            mb={20}
          />
        </div>
      ) : null}
      <div className="pricing-card__stats">
        <div className="pricing-card__stat">
          <span className="pricing-card__stat-label">{multiVariant ? `每月获得 · ${variant.capacityLabel}` : '每月获得'}</span>
          <strong className="pricing-card__stat-value">{variant.monthlyCredits.toLocaleString('zh-CN')}</strong>
        </div>
        {hasMembershipDailyGift(variant.dailyGiftCredits) ? (
          <div className="pricing-card__stat">
            <span className="pricing-card__stat-label">每日赠送 · 当日有效</span>
            <strong className="pricing-card__stat-value">{variant.dailyGiftCredits.toLocaleString('zh-CN')}</strong>
          </div>
        ) : null}
      </div>
      <button className="pricing-card__cta" type="button" disabled={busy} onClick={() => onPurchase(card, variant)}>
        {purchaseLabel(kind)} {card.product.title}
      </button>
      {card.campaignBenefits.length > 0 ? (
        <div className="pricing-card__group">
          <strong className="pricing-card__group-title">会员权益</strong>
          <ul className="pricing-card__benefits">
            {card.campaignBenefits.map((benefit) => <li key={benefit}>{benefit}</li>)}
          </ul>
        </div>
      ) : null}
      {card.features.length > 0 ? (
        <div className="pricing-card__group">
          <strong className="pricing-card__group-title">全部创作能力</strong>
          <ul className="pricing-card__benefits pricing-card__benefits--check">
            {card.features.map((feature) => <li key={feature}>{feature}</li>)}
          </ul>
        </div>
      ) : null}
    </article>
  )
}
