import React from 'react'
import QRCode from 'qrcode'
import {
  createAlipayTradePrecreate,
  createMembershipOrder,
  createWechatNativePayment,
  reconcileAlipayPayment,
  reconcileOrderPayment,
} from '../../api/server'
import { toast } from '../../ui/toast'

export type PayMethod = 'alipay' | 'wechat'

export type MembershipPurchasePhase =
  | { kind: 'idle' }
  | {
    kind: 'scanning'
    orderId: string
    orderNo: string
    amountCents: number
    method: PayMethod
    alipayQrCode: string | null
    wechatCodeUrl: string | null
    switching: boolean
  }
  | { kind: 'paid'; orderId: string }

export type MembershipPurchaseTarget = {
  productId: string
  skuId: string
  priceCents: number
}

export function useMembershipPurchase(onPurchased: () => Promise<void>): {
  busy: boolean
  phase: MembershipPurchasePhase
  qrDataUrl: string | null
  purchase: (target: MembershipPurchaseTarget) => Promise<void>
  switchPayMethod: (method: PayMethod) => Promise<void>
  closeScanModal: () => void
} {
  const [busy, setBusy] = React.useState(false)
  const [phase, setPhase] = React.useState<MembershipPurchasePhase>({ kind: 'idle' })
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null)
  const pollTimerRef = React.useRef<number | null>(null)
  const phaseRef = React.useRef<MembershipPurchasePhase>(phase)
  phaseRef.current = phase

  const stopPolling = React.useCallback(() => {
    if (pollTimerRef.current != null) {
      window.clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  React.useEffect(() => stopPolling, [stopPolling])

  const startPolling = React.useCallback((orderId: string, method: PayMethod) => {
    stopPolling()
    pollTimerRef.current = window.setInterval(() => {
      void (async () => {
        try {
          const result = method === 'alipay'
            ? await reconcileAlipayPayment(orderId)
            : await reconcileOrderPayment(orderId)
          if (result.orderPaymentStatus === 'paid') {
            stopPolling()
            setPhase({ kind: 'paid', orderId })
            toast('支付成功，会员权益已到账', 'success')
            await onPurchased()
          }
        } catch (reason: unknown) {
          // 对账失败（网络抖动、渠道支付尚未发起等）时保持轮询，交由下一次循环重试。
          console.warn('[membership] reconcile poll failed', reason)
        }
      })()
    }, 2500)
  }, [onPurchased, stopPolling])

  // 轮询跟随当前展示的支付渠道；渠道切换或弹窗关闭时重启/停止。
  const scanningOrderId = phase.kind === 'scanning' ? phase.orderId : null
  const scanningMethod = phase.kind === 'scanning' ? phase.method : null
  React.useEffect(() => {
    if (!scanningOrderId || !scanningMethod) return
    startPolling(scanningOrderId, scanningMethod)
    return () => stopPolling()
  }, [scanningOrderId, scanningMethod, startPolling, stopPolling])

  const createChannelQr = React.useCallback(async (orderId: string, method: PayMethod): Promise<string> => {
    if (method === 'alipay') {
      const dto = await createAlipayTradePrecreate(orderId)
      return dto.qrCode
    }
    const dto = await createWechatNativePayment(orderId)
    return dto.codeUrl
  }, [])

  const purchase = React.useCallback(async (target: MembershipPurchaseTarget) => {
    setBusy(true)
    try {
      const order = await createMembershipOrder({ items: [{ productId: target.productId, skuId: target.skuId, quantity: 1 }] })
      let alipayQrCode: string | null = null
      try {
        alipayQrCode = await createChannelQr(order.id, 'alipay')
      } catch (reason: unknown) {
        // 默认渠道失败不静默换渠道：弹窗保持支付宝并提示，用户可显式切换微信。
        toast(reason instanceof Error ? reason.message : '支付宝下单失败，可切换微信支付', 'error')
      }
      setPhase({
        kind: 'scanning',
        orderId: order.id,
        orderNo: order.orderNo,
        amountCents: target.priceCents,
        method: 'alipay',
        alipayQrCode,
        wechatCodeUrl: null,
        switching: false,
      })
    } catch (reason: unknown) {
      toast(reason instanceof Error ? reason.message : '创建订单失败', 'error')
    } finally {
      setBusy(false)
    }
  }, [createChannelQr])

  const switchPayMethod = React.useCallback(async (method: PayMethod) => {
    const current = phaseRef.current
    if (current.kind !== 'scanning' || current.method === method || current.switching) return
    const cached = method === 'alipay' ? current.alipayQrCode : current.wechatCodeUrl
    if (cached) {
      setPhase({ ...current, method })
      return
    }
    setPhase({ ...current, switching: true })
    try {
      const payload = await createChannelQr(current.orderId, method)
      setPhase((prev) => prev.kind === 'scanning'
        ? {
          ...prev,
          method,
          switching: false,
          ...(method === 'alipay' ? { alipayQrCode: payload } : { wechatCodeUrl: payload }),
        }
        : prev)
    } catch (reason: unknown) {
      setPhase((prev) => prev.kind === 'scanning' ? { ...prev, switching: false } : prev)
      toast(reason instanceof Error ? reason.message : '切换支付方式失败', 'error')
    }
  }, [createChannelQr])

  React.useEffect(() => {
    if (phase.kind !== 'scanning') {
      setQrDataUrl(null)
      return
    }
    const payload = phase.method === 'alipay' ? phase.alipayQrCode : phase.wechatCodeUrl
    if (!payload) {
      setQrDataUrl(null)
      return
    }
    let cancelled = false
    void QRCode.toDataURL(payload, { width: 320, margin: 1 })
      .then((url) => { if (!cancelled) setQrDataUrl(url) })
      .catch((reason: unknown) => {
        toast(reason instanceof Error ? reason.message : '生成付款二维码失败', 'error')
      })
    return () => { cancelled = true }
  }, [phase])

  const closeScanModal = React.useCallback(() => {
    stopPolling()
    setPhase({ kind: 'idle' })
  }, [stopPolling])

  return { busy, phase, qrDataUrl, purchase, switchPayMethod, closeScanModal }
}
