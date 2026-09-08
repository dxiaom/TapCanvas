import React from 'react'
import { Badge, Loader, Modal, SegmentedControl } from '@mantine/core'
import type { MembershipPurchasePhase, PayMethod } from './useMembershipPurchase'

const PRICE_YUAN = new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

function formatPrice(priceCents: number): string {
  return `¥${PRICE_YUAN.format(Math.max(0, priceCents) / 100)}`
}

export function MembershipScanModal({ phase, qrDataUrl, onClose, onSwitchMethod }: {
  phase: MembershipPurchasePhase
  qrDataUrl: string | null
  onClose: () => void
  onSwitchMethod: (method: PayMethod) => void
}): JSX.Element {
  const scanning = phase.kind === 'scanning' ? phase : null
  const hint = scanning
    ? (scanning.method === 'alipay'
      ? '请使用支付宝扫码完成支付，支付成功后本窗口自动关闭'
      : '请使用微信扫码完成支付，支付成功后本窗口自动关闭')
    : ''
  return (
    <Modal
      className="membership-scan-modal"
      opened={scanning != null}
      onClose={onClose}
      centered
      size="sm"
      title={scanning?.method === 'wechat' ? '微信扫码支付' : '支付宝扫码支付'}
    >
      {scanning ? (
        <div className="membership-scan-body">
          <SegmentedControl
            className="membership-scan-body__method"
            size="xs"
            value={scanning.method}
            disabled={scanning.switching}
            onChange={(value: string) => onSwitchMethod(value === 'wechat' ? 'wechat' : 'alipay')}
            data={[
              { label: '支付宝', value: 'alipay' },
              { label: '微信', value: 'wechat' },
            ]}
          />
          <div className="membership-scan-body__amount">{formatPrice(scanning.amountCents)}</div>
          {qrDataUrl
            ? <img className="membership-scan-body__qr" src={qrDataUrl} alt={`${scanning.method === 'alipay' ? '支付宝' : '微信'}支付二维码`} />
            : (
              <div className="membership-scan-body__loading">
                {scanning.switching || (scanning.method === 'alipay' ? scanning.alipayQrCode == null : scanning.wechatCodeUrl == null)
                  ? (
                    <>
                      <Loader className="membership-scan-body__loader" size="sm" />
                      <span className="membership-scan-body__loading-text">
                        {scanning.switching ? '正在切换支付方式…' : `${scanning.method === 'alipay' ? '支付宝' : '微信'}下单失败，可切换支付方式重试`}
                      </span>
                    </>
                  )
                  : null}
              </div>
            )}
          <div className="membership-scan-body__hint">{hint}</div>
          {phase.kind === 'paid' ? <Badge className="membership-scan-body__done" color="green">已支付</Badge> : null}
        </div>
      ) : null}
    </Modal>
  )
}
