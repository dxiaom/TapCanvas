import { z } from "zod";

export const CreateAlipayTradeRequestSchema = z.object({
	orderId: z.string().trim().min(1),
});

export const CreateAlipayTradeResponseSchema = z.object({
	paymentId: z.string(),
	orderId: z.string(),
	orderNo: z.string(),
	outTradeNo: z.string(),
	qrCode: z.string(),
	expiresAt: z.string().nullable(),
	createdAt: z.string(),
});

export const AlipayPaymentSchema = z.object({
	id: z.string(),
	ownerId: z.string(),
	orderId: z.string(),
	provider: z.literal("alipay"),
	tradeType: z.literal("FACE_TO_FACE"),
	outTradeNo: z.string(),
	prepayId: z.string().nullable(),
	transactionId: z.string().nullable(),
	status: z.enum(["created", "pending", "success", "failed", "closed", "refunding", "refunded"]),
	totalAmountCents: z.number().int().nonnegative(),
	currency: z.string(),
	refundAmountCents: z.number().int().nonnegative(),
	refundStatus: z.string().nullable(),
	refundReason: z.string().nullable(),
	rawRequestJson: z.string().nullable(),
	rawResponseJson: z.string().nullable(),
	createdAt: z.string(),
	updatedAt: z.string(),
	succeededAt: z.string().nullable(),
	closedAt: z.string().nullable(),
});

export const AlipayPaymentReconcileResponseSchema = z.object({
	orderId: z.string(),
	outTradeNo: z.string(),
	paymentStatus: z.enum(["pending", "success"]),
	orderPaymentStatus: z.enum(["unpaid", "paid"]),
	tradeStatus: z.string().nullable(),
	transactionId: z.string().nullable(),
});
