import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { authMiddleware } from "../../middleware/auth";
import {
	CreateAlipayTradeRequestSchema,
	CreateAlipayTradeResponseSchema,
	AlipayPaymentReconcileResponseSchema,
	AlipayPaymentSchema,
} from "./alipay.schemas";
import {
	createAlipayPrecreateForOrder,
	getAlipayPaymentForOrder,
	handleAlipayPaymentCallback,
	reconcileAlipayPaymentForOrder,
} from "./alipay.service";

export const alipayRouter = new Hono<AppEnv>();

// 支付宝异步通知：要求返回纯文本 "success"，否则网关会按退避策略重发。
alipayRouter.post("/callback", async (c) => {
	const bodyText = await c.req.text();
	const ack = await handleAlipayPaymentCallback(c, bodyText);
	return c.text(ack.code === "success" ? "success" : "failure");
});

const authed = new Hono<AppEnv>();
authed.use("*", authMiddleware);

authed.post("/trade/precreate", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const parsed = CreateAlipayTradeRequestSchema.safeParse(body);
	if (!parsed.success) {
		return c.json({ error: "Invalid request body", issues: parsed.error.issues }, 400);
	}
	const dto = await createAlipayPrecreateForOrder(c, {
		ownerId: userId,
		orderId: parsed.data.orderId,
	});
	return c.json(CreateAlipayTradeResponseSchema.parse(dto));
});

authed.get("/orders/:orderId", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const dto = await getAlipayPaymentForOrder(c, {
		ownerId: userId,
		orderId: c.req.param("orderId"),
	});
	return c.json(AlipayPaymentSchema.parse(dto));
});

authed.post("/orders/:orderId/reconcile", async (c) => {
	const userId = c.get("userId");
	if (!userId) return c.json({ error: "Unauthorized" }, 401);
	const dto = await reconcileAlipayPaymentForOrder(c, {
		ownerId: userId,
		orderId: c.req.param("orderId"),
	});
	return c.json(AlipayPaymentReconcileResponseSchema.parse(dto));
});

alipayRouter.route("/", authed);
