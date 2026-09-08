import type { Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../../middleware/error";
import type { AppContext } from "../../types";
import { getPrismaClient } from "../../platform/node/prisma";
import { MembershipConfigSchema } from "../commerce/commerce.schemas";
import { grantInitialMembershipCredits } from "../commerce/membership-credit.service";
import { ensurePersonalBillingTeam } from "../team/team.service";

type MembershipVariantConfig = {
	billingCycle: "monthly" | "annual";
	durationDays: number;
	monthlyCredits: number;
	dailyGiftCredits: number;
	concurrencyLimit: number;
	capacityLabel: string;
	timezone: string;
};

type OrderItemRecord = {
	id: string;
	order_id: string;
	product_id: string;
	sku_id: string | null;
	title_snapshot: string;
	sku_name_snapshot: string | null;
	quantity: number;
};

type EntitlementLogInput = {
	tx: Prisma.TransactionClient;
	id: string;
	ownerId: string;
	orderId: string;
	orderItemId: string;
	productId: string;
	status: "applied" | "skipped";
	resultJson: string | null;
	nowIso: string;
};

function parseMembershipVariant(
	rawConfigJson: string | null,
	skuId: string | null,
): MembershipVariantConfig {
	let raw: unknown;
	try {
		raw = rawConfigJson ? JSON.parse(rawConfigJson) : {};
	} catch (error: unknown) {
		throw new AppError("个人套餐权益配置不是有效 JSON", {
			status: 500,
			code: "membership_config_json_invalid",
			details: error instanceof Error ? error.message : String(error),
		});
	}
	const parsed = MembershipConfigSchema.safeParse(raw);
	if (!parsed.success) {
		throw new AppError("个人套餐权益配置不正确", {
			status: 500,
			code: "membership_config_invalid",
			details: parsed.error.issues,
		});
	}
	const selected = skuId ? parsed.data.skuConfigs?.[skuId] : parsed.data;
	if (!selected) {
		throw new AppError("会员 SKU 缺少权益配置", {
			status: 500,
			code: "membership_sku_config_missing",
			details: { skuId },
		});
	}
	return selected;
}

function parseMembershipPlanCode(productId: string, skuId: string | null): string {
	return `membership:${productId}:${skuId ?? "default"}`;
}

async function writeEntitlementLog(input: EntitlementLogInput): Promise<void> {
	await input.tx.order_entitlements.create({
		data: {
			id: input.id,
			owner_id: input.ownerId,
			order_id: input.orderId,
			order_item_id: input.orderItemId,
			product_id: input.productId,
			entitlement_type: "membership",
			status: input.status,
			result_json: input.resultJson,
			created_at: input.nowIso,
			updated_at: input.nowIso,
		},
	});
}

async function fulfillMembershipItem(
	c: AppContext,
	tx: Prisma.TransactionClient,
	input: {
		ownerId: string;
		orderId: string;
		item: OrderItemRecord;
		now: Date;
		nowIso: string;
	},
): Promise<void> {
	const existingGrant = await tx.order_entitlements.findFirst({
		where: { order_item_id: input.item.id, entitlement_type: "membership" },
		select: { id: true },
	});
	if (existingGrant) return;

	const entitlement = await tx.product_entitlements.findFirst({
		where: { product_id: input.item.product_id, entitlement_type: "membership" },
	});
	if (!entitlement) {
		await writeEntitlementLog({
			tx,
			id: crypto.randomUUID(),
			ownerId: input.ownerId,
			orderId: input.orderId,
			orderItemId: input.item.id,
			productId: input.item.product_id,
			status: "skipped",
			resultJson: JSON.stringify({ reason: "membership_entitlement_missing" }),
			nowIso: input.nowIso,
		});
		return;
	}

	const variant = parseMembershipVariant(entitlement.config_json, input.item.sku_id);
	const planCode = parseMembershipPlanCode(input.item.product_id, input.item.sku_id);
	const teamId = await ensurePersonalBillingTeam(c, input.ownerId);
	if (!teamId) {
		throw new AppError("个人积分钱包不存在", {
			status: 500,
			code: "personal_billing_team_missing",
		});
	}

	const subscriptionId = crypto.randomUUID();
	const endAt = new Date(input.now.getTime() + variant.durationDays * 86_400_000);
	const creditGrantCount = variant.billingCycle === "annual" ? 12 : 1;
	const nextGrantDate = new Date(input.now.getTime());
	nextGrantDate.setUTCMonth(nextGrantDate.getUTCMonth() + 1);
	const nextCreditGrantAt =
		creditGrantCount > 1 && nextGrantDate < endAt ? nextGrantDate.toISOString() : null;

	await tx.subscriptions.updateMany({
		where: { owner_id: input.ownerId, status: "active", monthly_credits: { gt: 0 } },
		data: { status: "canceled", canceled_at: input.nowIso, updated_at: input.nowIso, next_credit_grant_at: null },
	});
	await tx.subscriptions.create({
		data: {
			id: subscriptionId,
			owner_id: input.ownerId,
			plan_code: planCode,
			source_order_id: input.orderId,
			status: "active",
			start_at: input.nowIso,
			end_at: endAt.toISOString(),
			duration_days: variant.durationDays,
			daily_limit: variant.dailyGiftCredits,
			billing_team_id: teamId,
			billing_cycle: variant.billingCycle,
			monthly_credits: variant.monthlyCredits,
			daily_gift_credits: variant.dailyGiftCredits,
			concurrency_limit: variant.concurrencyLimit,
			capacity_label: variant.capacityLabel,
			credit_grant_count: creditGrantCount,
			credit_grants_issued: 1,
			next_credit_grant_at: nextCreditGrantAt,
			timezone: variant.timezone,
			created_at: input.nowIso,
			updated_at: input.nowIso,
			canceled_at: null,
		},
	});
	await grantInitialMembershipCredits(tx, {
		subscriptionId,
		ownerId: input.ownerId,
		teamId,
		monthlyCredits: variant.monthlyCredits,
		dailyGiftCredits: variant.dailyGiftCredits,
		timezone: variant.timezone,
	}, input.now);
	await writeEntitlementLog({
		tx,
		id: crypto.randomUUID(),
		ownerId: input.ownerId,
		orderId: input.orderId,
		orderItemId: input.item.id,
		productId: input.item.product_id,
		status: "applied",
		resultJson: JSON.stringify({
			subscriptionId,
			planCode,
			billingCycle: variant.billingCycle,
			monthlyCredits: variant.monthlyCredits,
			dailyGiftCredits: variant.dailyGiftCredits,
			concurrencyLimit: variant.concurrencyLimit,
			teamId,
			quantity: input.item.quantity,
		}),
		nowIso: input.nowIso,
	});
}

/**
 * 支付确认后的订单发货：单个事务内原子标记已支付并开通个人会员。
 * 幂等保障：
 *  - 订单标记以 `payment_status != 'paid'` 为条件更新，重复回调直接短路返回；
 *  - order_entitlements 的 (order_item_id, entitlement_type) 唯一约束防重复发放积分。
 */
export async function fulfillPaidMembershipOrder(
	c: AppContext,
	input: {
		ownerId: string;
		orderId: string;
		paidAmountCents: number;
		previousStatus: string;
		paymentPayload: Record<string, unknown>;
	},
): Promise<void> {
	const prisma: PrismaClient = getPrismaClient();
	const now = new Date();
	const nowIso = now.toISOString();

	await prisma.$transaction(async (tx) => {
		const marked = await tx.orders.updateMany({
			where: { id: input.orderId, owner_id: input.ownerId, payment_status: { not: "paid" } },
			data: {
				status: "paid",
				payment_status: "paid",
				paid_amount_cents: input.paidAmountCents,
				paid_at: nowIso,
				updated_at: nowIso,
			},
		});
		if (marked.count === 0) return;

		await tx.order_status_events.create({
			data: {
				id: crypto.randomUUID(),
				order_id: input.orderId,
				owner_id: input.ownerId,
				from_status: input.previousStatus,
				to_status: "paid",
				event_type: "payment_confirmed",
				reason: null,
				payload_json: JSON.stringify(input.paymentPayload),
				created_at: nowIso,
			},
		});

		const items = await tx.order_items.findMany({
			where: { order_id: input.orderId },
			orderBy: { created_at: "asc" },
		});
		for (const item of items) {
			await fulfillMembershipItem(c, tx, {
				ownerId: input.ownerId,
				orderId: input.orderId,
				item: {
					id: item.id,
					order_id: item.order_id,
					product_id: item.product_id,
					sku_id: item.sku_id,
					title_snapshot: item.title_snapshot,
					sku_name_snapshot: item.sku_name_snapshot,
					quantity: item.quantity,
				},
				now,
				nowIso,
			});
		}
	});
}
