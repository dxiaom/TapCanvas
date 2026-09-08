import { createSign, createVerify } from "node:crypto";
import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { getOrderById, getOrderByNo } from "../order/order.repo";
import { markOrderPaidFromPaymentCallback } from "../order/order.service";
import {
	createPayment,
	createPaymentCallbackLog,
	getPaymentByOrderId,
	getPaymentByOutTradeNo,
	updatePaymentAsSucceeded,
	type PaymentRow,
} from "../payments/payments.repo";
import { buildAlipayUserMessage } from "./alipay.error-messages";

const DEFAULT_ALIPAY_GATEWAY = "https://openapi.alipay.com/gateway.do";
// 交易终态：支付成功或交易结束（不可再退款），均视为已支付入账。
const TRADE_SUCCESS_STATUSES = new Set(["TRADE_SUCCESS", "TRADE_FINISHED"]);

type AlipayEnv = {
	appId: string;
	privateKeyPem: string;
	alipayPublicKeyPem: string;
	gateway: string;
	notifyUrl: string;
};

function requireAlipayString(c: AppContext, key: "ALIPAY_APP_ID" | "ALIPAY_PRIVATE_KEY" | "ALIPAY_ALIPAY_PUBLIC_KEY" | "ALIPAY_NOTIFY_URL"): string {
	const value = c.env[key];
	const text = typeof value === "string" ? value.trim() : "";
	if (!text) {
		throw new AppError(`支付宝支付未配置：缺少环境变量 ${key}`, {
			status: 500,
			code: "alipay_env_missing",
			details: { key },
		});
	}
	return text;
}

function resolveAlipayEnv(c: AppContext): AlipayEnv {
	const gatewayFromEnv = typeof c.env.ALIPAY_GATEWAY === "string" ? c.env.ALIPAY_GATEWAY.trim() : "";
	return {
		appId: requireAlipayString(c, "ALIPAY_APP_ID"),
		privateKeyPem: normalizePkcs8Pem(requireAlipayString(c, "ALIPAY_PRIVATE_KEY"), "PRIVATE KEY"),
		alipayPublicKeyPem: normalizePkcs8Pem(requireAlipayString(c, "ALIPAY_ALIPAY_PUBLIC_KEY"), "PUBLIC KEY"),
		gateway: gatewayFromEnv || DEFAULT_ALIPAY_GATEWAY,
		notifyUrl: requireAlipayString(c, "ALIPAY_NOTIFY_URL"),
	};
}

// 支付宝开放平台工具导出的密钥常是"单行裸 base64"（PKCS8）；补齐 PEM 头尾与换行，
// 已是完整 PEM 时原样返回。
function normalizePkcs8Pem(raw: string, label: "PRIVATE KEY" | "PUBLIC KEY"): string {
	const compact = raw.replaceAll("\\n", "\n").trim();
	if (compact.includes("-----BEGIN")) return compact.replaceAll(/\r\n/g, "\n");
	const body = compact.replace(/\s+/g, "");
	const lines = body.match(/.{1,64}/g) ?? [body];
	return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

// 支付宝签名串：剔除 sign 与空值，按 key ASCII 升序 k=v& 拼接，值不做 URL 编码。
function buildSignContent(params: Record<string, string>, excludeSignType: boolean): string {
	return Object.keys(params)
		.filter((key) => {
			if (key === "sign") return false;
			if (excludeSignType && key === "sign_type") return false;
			const value = params[key];
			return value != null && value !== "";
		})
		.sort()
		.map((key) => `${key}=${params[key]}`)
		.join("&");
}

function signWithAppPrivateKey(content: string, privateKeyPem: string): string {
	const signer = createSign("RSA-SHA256");
	signer.update(content, "utf8");
	signer.end();
	return signer.sign(privateKeyPem, "base64");
}

function verifyWithAlipayPublicKey(content: string, signatureBase64: string, alipayPublicKeyPem: string): boolean {
	try {
		const verifier = createVerify("RSA-SHA256");
		verifier.update(content, "utf8");
		verifier.end();
		return verifier.verify(alipayPublicKeyPem, signatureBase64, "base64");
	} catch {
		return false;
	}
}

// 北京时间 yyyy-MM-dd HH:mm:ss（支付宝网关 timestamp 的固定格式）。
function beijingTimestamp(): string {
	const formatter = new Intl.DateTimeFormat("sv-SE", {
		timeZone: "Asia/Shanghai",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
	});
	return formatter.format(new Date());
}

// 从网关原始响应里提取指定响应节点的"字面文本"（验签必须用原始字节，不能重新序列化）。
function extractRawResponseNode(rawText: string, responseKey: string): string | null {
	const keyIndex = rawText.indexOf(`"${responseKey}"`);
	if (keyIndex < 0) return null;
	const braceStart = rawText.indexOf("{", keyIndex);
	if (braceStart < 0) return null;
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = braceStart; i < rawText.length; i++) {
		const ch = rawText[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') inString = true;
		else if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) return rawText.slice(braceStart, i + 1);
		}
	}
	return null;
}

type AlipayGatewayResult = {
	rawText: string;
	node: Record<string, unknown>;
	signVerified: boolean;
};

async function callAlipayGateway(
	env: AlipayEnv,
	method: string,
	bizContent: Record<string, unknown>,
): Promise<AlipayGatewayResult> {
	const responseKey = `${method.replaceAll(".", "_")}_response`;
	const params: Record<string, string> = {
		app_id: env.appId,
		method,
		format: "JSON",
		charset: "utf-8",
		sign_type: "RSA2",
		timestamp: beijingTimestamp(),
		version: "1.0",
		notify_url: env.notifyUrl,
		biz_content: JSON.stringify(bizContent),
	};
	const sign = signWithAppPrivateKey(buildSignContent(params, false), env.privateKeyPem);
	const body = new URLSearchParams({ ...params, sign });

	let rawText = "";
	try {
		const response = await fetch(env.gateway, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: body.toString(),
		});
		rawText = await response.text();
	} catch (error: unknown) {
		throw new AppError("Alipay gateway request failed", {
			status: 502,
			code: "alipay_gateway_unreachable",
			details: {
				gateway: env.gateway,
				method,
				reason: error instanceof Error ? error.message : String(error),
			},
		});
	}

	let parsed: Record<string, unknown>;
	try {
		const value: unknown = JSON.parse(rawText);
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw new Error("response is not an object");
		}
		parsed = value as Record<string, unknown>;
	} catch {
		throw new AppError("Alipay gateway returned invalid JSON", {
			status: 502,
			code: "alipay_gateway_invalid_json",
			details: { method, rawText: rawText.slice(0, 500) },
		});
	}

	const rawNode = extractRawResponseNode(rawText, responseKey);
	const signFromGateway = typeof parsed.sign === "string" ? parsed.sign : "";
	const nodeValue = parsed[responseKey];
	const node = (nodeValue && typeof nodeValue === "object" && !Array.isArray(nodeValue))
		? (nodeValue as Record<string, unknown>)
		: {};
	const signVerified = Boolean(rawNode && signFromGateway)
		? verifyWithAlipayPublicKey(rawNode, signFromGateway, env.alipayPublicKeyPem)
		: false;
	if (rawNode && signFromGateway && !signVerified) {
		throw new AppError("Alipay response signature invalid", {
			status: 502,
			code: "alipay_response_signature_invalid",
			details: { method, responseKey },
		});
	}

	return { rawText, node, signVerified };
}

function readAlipayErrorCode(node: Record<string, unknown>): { code: string; subCode: string; subMsg: string } {
	return {
		code: typeof node.code === "string" ? node.code : "",
		subCode: typeof node.sub_code === "string" ? node.sub_code : "",
		subMsg: typeof node.sub_msg === "string" ? node.sub_msg : "",
	};
}

function safeJsonParseObject(value: string | null): Record<string, unknown> | null {
	if (!value) return null;
	try {
		const parsed: unknown = JSON.parse(value);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return null;
	} catch {
		return null;
	}
}

function readQrCodeFromPayment(payment: PaymentRow): string {
	const raw = safeJsonParseObject(payment.raw_response_json);
	const qrCode = typeof raw?.qr_code === "string" ? raw.qr_code.trim() : "";
	return qrCode;
}

async function ensureRecoveredPaymentForOrder(c: AppContext, input: {
	order: { id: string; owner_id: string; total_amount_cents: unknown; currency: string | null };
	outTradeNo: string;
	status?: PaymentRow["status"];
	rawResponseJson: string | null;
	nowIso?: string;
}): Promise<PaymentRow> {
	const existed = await getPaymentByOutTradeNo(c.env.DB, { outTradeNo: input.outTradeNo });
	if (existed) return existed;

	const nowIso = input.nowIso || new Date().toISOString();
	const paymentId = crypto.randomUUID();
	await createPayment(c.env.DB, {
		id: paymentId,
		ownerId: input.order.owner_id,
		orderId: input.order.id,
		provider: "alipay",
		tradeType: "FACE_TO_FACE",
		outTradeNo: input.outTradeNo,
		prepayId: null,
		status: input.status ?? "pending",
		totalAmountCents: Number(input.order.total_amount_cents ?? 0) || 0,
		currency: input.order.currency || "CNY",
		rawRequestJson: null,
		rawResponseJson: input.rawResponseJson,
		nowIso,
	});
	const recovered = await getPaymentByOutTradeNo(c.env.DB, { outTradeNo: input.outTradeNo });
	if (!recovered) {
		throw new AppError("Recovered alipay payment create failed", {
			status: 500,
			code: "payment_recover_create_failed",
			details: { orderId: input.order.id, outTradeNo: input.outTradeNo },
		});
	}
	return recovered;
}

export async function createAlipayPrecreateForOrder(c: AppContext, input: {
	ownerId: string;
	orderId: string;
}) {
	const env = resolveAlipayEnv(c);
	const order = await getOrderById(c.env.DB, { orderId: input.orderId, ownerId: input.ownerId });
	if (!order) {
		throw new AppError("Order not found", { status: 404, code: "order_not_found" });
	}
	if (order.payment_status === "paid") {
		throw new AppError("Order already paid", { status: 400, code: "order_already_paid" });
	}
	if (order.status === "canceled") {
		throw new AppError("Order canceled", { status: 400, code: "order_canceled" });
	}

	const existed = await getPaymentByOrderId(c.env.DB, {
		orderId: order.id,
		ownerId: input.ownerId,
	});
	if (existed && existed.status === "success") {
		throw new AppError("Order already paid", { status: 400, code: "order_already_paid" });
	}
	// 幂等：已有一笔 pending 的支付宝预下单且二维码仍可用，直接复用，不重复向网关申请。
	if (existed && existed.provider === "alipay" && existed.status === "pending") {
		const qrCode = readQrCodeFromPayment(existed);
		if (qrCode) {
			return {
				paymentId: existed.id,
				orderId: order.id,
				orderNo: order.order_no,
				outTradeNo: existed.out_trade_no,
				qrCode,
				expiresAt: null,
				createdAt: existed.created_at,
			};
		}
	}

	const outTradeNo = existed?.out_trade_no || order.order_no;
	const totalAmount = (Math.max(0, Number(order.total_amount_cents ?? 0) || 0) / 100).toFixed(2);
	const bizContent = {
		out_trade_no: outTradeNo,
		total_amount: totalAmount,
		subject: `TapCanvas Order ${order.order_no}`,
	};
	const result = await callAlipayGateway(env, "alipay.trade.precreate", bizContent);
	const { code, subCode, subMsg } = readAlipayErrorCode(result.node);
	if (code !== "10000") {
		console.error("[alipay] precreate failed", {
			orderId: order.id,
			outTradeNo,
			code,
			subCode,
			subMsg,
			node: result.node,
			signVerified: result.signVerified,
		});
		throw new AppError(buildAlipayUserMessage({ action: "下单", code, subCode, subMsg }), {
			status: 502,
			code: "alipay_precreate_failed",
			details: { code, subCode, subMsg, node: result.node },
		});
	}
	const qrCode = typeof result.node.qr_code === "string" ? result.node.qr_code.trim() : "";
	if (!qrCode) {
		throw new AppError("Alipay precreate response missing qr_code", {
			status: 502,
			code: "alipay_precreate_qr_code_missing",
			details: result.node,
		});
	}

	const nowIso = new Date().toISOString();
	const paymentId = existed?.id || crypto.randomUUID();
	if (!existed) {
		await createPayment(c.env.DB, {
			id: paymentId,
			ownerId: input.ownerId,
			orderId: order.id,
			provider: "alipay",
			tradeType: "FACE_TO_FACE",
			outTradeNo,
			prepayId: null,
			status: "pending",
			totalAmountCents: Number(order.total_amount_cents ?? 0) || 0,
			currency: order.currency || "CNY",
			rawRequestJson: JSON.stringify(bizContent),
			rawResponseJson: JSON.stringify(result.node),
			nowIso,
		});
	}

	return {
		paymentId,
		orderId: order.id,
		orderNo: order.order_no,
		outTradeNo,
		qrCode,
		expiresAt: null,
		createdAt: nowIso,
	};
}

function mapPaymentRowToDto(row: PaymentRow) {
	return {
		id: row.id,
		ownerId: row.owner_id,
		orderId: row.order_id,
		provider: row.provider,
		tradeType: row.trade_type,
		outTradeNo: row.out_trade_no,
		prepayId: row.prepay_id,
		transactionId: row.transaction_id,
		status: row.status,
		totalAmountCents: Number(row.total_amount_cents ?? 0) || 0,
		currency: row.currency,
		refundAmountCents: Number(row.refund_amount_cents ?? 0) || 0,
		refundStatus: row.refund_status,
		refundReason: row.refund_reason,
		rawRequestJson: row.raw_request_json,
		rawResponseJson: row.raw_response_json,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		succeededAt: row.succeeded_at,
		closedAt: row.closed_at,
	};
}

export async function getAlipayPaymentForOrder(c: AppContext, input: {
	ownerId: string;
	orderId: string;
}) {
	const payment = await getPaymentByOrderId(c.env.DB, input);
	if (!payment) {
		throw new AppError("Payment not found", { status: 404, code: "payment_not_found" });
	}
	return mapPaymentRowToDto(payment);
}

export async function reconcileAlipayPaymentForOrder(c: AppContext, input: {
	ownerId: string;
	orderId: string;
}) {
	const env = resolveAlipayEnv(c);
	const order = await getOrderById(c.env.DB, {
		orderId: input.orderId,
		ownerId: input.ownerId,
	});
	if (!order) {
		throw new AppError("Order not found", { status: 404, code: "order_not_found" });
	}
	let payment = await getPaymentByOrderId(c.env.DB, {
		ownerId: input.ownerId,
		orderId: input.orderId,
	});
	const outTradeNo = payment?.out_trade_no || order.order_no;
	if (payment?.status === "success" || order.payment_status === "paid") {
		return {
			orderId: input.orderId,
			outTradeNo,
			paymentStatus: "success" as const,
			orderPaymentStatus: "paid" as const,
			tradeStatus: "TRADE_SUCCESS",
			transactionId: payment?.transaction_id ?? null,
		};
	}

	const result = await callAlipayGateway(env, "alipay.trade.query", { out_trade_no: outTradeNo });
	const { code, subCode, subMsg } = readAlipayErrorCode(result.node);
	// 订单尚未被扫码创建交易：正常 pending，前端继续轮询。
	if (code === "40004" && subCode === "ACQ.TRADE_NOT_EXIST") {
		return {
			orderId: input.orderId,
			outTradeNo,
			paymentStatus: "pending" as const,
			orderPaymentStatus: "unpaid" as const,
			tradeStatus: null,
			transactionId: null,
		};
	}
	if (code !== "10000") {
		console.error("[alipay] query failed", {
			orderId: input.orderId,
			outTradeNo,
			code,
			subCode,
			subMsg,
			node: result.node,
		});
		throw new AppError(buildAlipayUserMessage({ action: "查询", code, subCode, subMsg }), {
			status: 502,
			code: "alipay_query_failed",
			details: { code, subCode, subMsg, node: result.node },
		});
	}
	const tradeStatus = typeof result.node.trade_status === "string" ? result.node.trade_status : null;
	const transactionId = typeof result.node.trade_no === "string" ? result.node.trade_no : null;
	if (!payment) {
		payment = await ensureRecoveredPaymentForOrder(c, {
			order,
			outTradeNo,
			rawResponseJson: JSON.stringify(result.node),
		});
	}

	if (tradeStatus && TRADE_SUCCESS_STATUSES.has(tradeStatus)) {
		const paidAmountCents = Math.round((Number(result.node.total_amount ?? 0) || 0) * 100);
		if (paidAmountCents <= 0) {
			throw new AppError("Invalid paid amount from alipay query", {
				status: 400,
				code: "alipay_query_paid_amount_invalid",
				details: { outTradeNo, totalAmount: result.node.total_amount ?? null },
			});
		}
		await updatePaymentAsSucceeded(c.env.DB, {
			id: payment.id,
			transactionId: transactionId || payment.transaction_id || "",
			rawResponseJson: JSON.stringify(result.node),
			nowIso: new Date().toISOString(),
		});
		await markOrderPaidFromPaymentCallback(c, {
			ownerId: input.ownerId,
			orderId: input.orderId,
			paidAmountCents,
			paymentPayload: {
				source: "active_query",
				outTradeNo,
				tradeNo: transactionId,
				tradeStatus,
				queryData: result.node,
			},
		});
		return {
			orderId: input.orderId,
			outTradeNo,
			paymentStatus: "success" as const,
			orderPaymentStatus: "paid" as const,
			tradeStatus,
			transactionId,
		};
	}

	return {
		orderId: input.orderId,
		outTradeNo,
		paymentStatus: "pending" as const,
		orderPaymentStatus: "unpaid" as const,
		tradeStatus,
		transactionId,
	};
}

function parseCallbackForm(bodyText: string): Record<string, string> {
	const params: Record<string, string> = {};
	for (const [key, value] of new URLSearchParams(bodyText)) {
		params[key] = value;
	}
	return params;
}

export async function handleAlipayPaymentCallback(c: AppContext, bodyText: string): Promise<{ code: string; message: string }> {
	const env = resolveAlipayEnv(c);
	const params = parseCallbackForm(bodyText);
	const signature = typeof params.sign === "string" ? params.sign : "";
	const outTradeNo = typeof params.out_trade_no === "string" ? params.out_trade_no.trim() : "";
	const tradeNo = typeof params.trade_no === "string" ? params.trade_no.trim() : "";
	const tradeStatus = typeof params.trade_status === "string" ? params.trade_status.trim() : "";
	const eventType = tradeStatus
		|| (typeof params.notify_type === "string" ? params.notify_type : "")
		|| "UNKNOWN";
	const logCreatedAt = new Date().toISOString();

	const signContent = buildSignContent(params, true);
	const signatureValid = Boolean(signature)
		? verifyWithAlipayPublicKey(signContent, signature, env.alipayPublicKeyPem)
		: false;

	const payment = outTradeNo ? await getPaymentByOutTradeNo(c.env.DB, { outTradeNo }) : null;
	await createPaymentCallbackLog(c.env.DB, {
		id: crypto.randomUUID(),
		paymentId: payment?.id || null,
		provider: "alipay",
		eventType,
		outTradeNo: outTradeNo || null,
		transactionId: tradeNo || null,
		signatureValid,
		payloadJson: JSON.stringify(params),
		headersJson: JSON.stringify({ contentType: c.req.header("content-type") || "" }),
		errorMessage: signatureValid ? null : "alipay callback signature invalid",
		createdAt: logCreatedAt,
	});

	if (!signatureValid) {
		throw new AppError("Alipay callback signature invalid", {
			status: 400,
			code: "alipay_callback_signature_invalid",
			details: { outTradeNo: outTradeNo || null },
		});
	}
	if (!outTradeNo) {
		throw new AppError("Missing out_trade_no", {
			status: 400,
			code: "alipay_callback_out_trade_no_missing",
		});
	}

	let resolvedPayment = payment;
	if (!resolvedPayment) {
		const order = await getOrderByNo(c.env.DB, { orderNo: outTradeNo });
		if (!order) {
			throw new AppError("Payment not found for callback", {
				status: 404,
				code: "payment_not_found",
				details: { outTradeNo },
			});
		}
		resolvedPayment = await ensureRecoveredPaymentForOrder(c, {
			order,
			outTradeNo,
			rawResponseJson: JSON.stringify(params),
			nowIso: logCreatedAt,
		});
	}
	// 验签通过但状态未到终态（如扫码未付）：直接 ack，支付宝稍后会再通知。
	if (!tradeStatus || !TRADE_SUCCESS_STATUSES.has(tradeStatus)) {
		return { code: "success", message: "OK" };
	}
	if (resolvedPayment.status === "success") {
		return { code: "success", message: "OK" };
	}

	const paidAmountCents = Math.round((Number(params.total_amount ?? 0) || 0) * 100);
	if (paidAmountCents <= 0) {
		throw new AppError("Invalid paid amount from callback", {
			status: 400,
			code: "alipay_callback_paid_amount_invalid",
			details: { outTradeNo, totalAmount: params.total_amount ?? null },
		});
	}

	await updatePaymentAsSucceeded(c.env.DB, {
		id: resolvedPayment.id,
		transactionId: tradeNo,
		rawResponseJson: JSON.stringify(params),
		nowIso: new Date().toISOString(),
	});

	await markOrderPaidFromPaymentCallback(c, {
		ownerId: resolvedPayment.owner_id,
		orderId: resolvedPayment.order_id,
		paidAmountCents,
		paymentPayload: { source: "async_notify", ...params },
	});

	return { code: "success", message: "OK" };
}
