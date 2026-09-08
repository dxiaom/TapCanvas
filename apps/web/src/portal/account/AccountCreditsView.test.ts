import { describe, expect, it } from 'vitest'
import { presentCreditEntry, presentMembershipEntitlements } from './AccountCreditsView'

describe('account credit ledger presentation', () => {
  it('distinguishes a reservation from an actual deduction', () => {
    expect(presentCreditEntry({ type: 'reserve', amount: 2813, settlesReservation: false })).toEqual({
      label: '冻结积分',
      amountText: '冻结 2,813',
      tone: 'reserve',
      explanation: '预占额度，不是实际扣减',
    })
    expect(presentCreditEntry({ type: 'deduct', amount: 2813, settlesReservation: true })).toEqual({
      label: '扣减积分',
      amountText: '−2,813',
      tone: 'deduct',
      explanation: '由冻结额度结算，可用积分不会重复减少',
    })
  })

  it('labels a release as restored availability instead of another charge', () => {
    expect(presentCreditEntry({ type: 'release', amount: 2813, settlesReservation: true })).toMatchObject({
      label: '解冻积分',
      amountText: '解冻 2,813',
      tone: 'release',
    })
  })

  it('keeps a direct deduction distinct from reservation settlement', () => {
    expect(presentCreditEntry({ type: 'deduct', amount: 30, settlesReservation: false })).toMatchObject({
      label: '扣减积分',
      amountText: '−30',
      explanation: '直接扣减',
    })
  })
})

describe('membership entitlement presentation', () => {
  const baseCurrent = {
    planCode: 'membership:sys_membership_plus:sys_membership_plus-membership-monthly',
    planName: 'PLUS',
    startAt: '2026-09-01T00:00:00.000Z',
    endAt: '2026-10-01T00:00:00.000Z',
    billingCycle: 'monthly' as const,
    monthlyCredits: 9900,
    dailyGiftCredits: 350,
    concurrencyLimit: 6,
    capacityLabel: '',
  }

  it('lists monthly and daily credits plus concurrency for fixed-credit plans', () => {
    expect(presentMembershipEntitlements(baseCurrent)).toEqual([
      { label: '每月积分', value: '9,900' },
      { label: '每日赠送', value: '350' },
      { label: '同时任务', value: '6' },
    ])
  })

  it('keeps the dynamic capacity label between credits and concurrency', () => {
    expect(presentMembershipEntitlements({ ...baseCurrent, capacityLabel: '6.4w' })).toEqual([
      { label: '每月积分', value: '9,900' },
      { label: '每日赠送', value: '350' },
      { label: '动态算力', value: '6.4w' },
      { label: '同时任务', value: '6' },
    ])
  })
})
