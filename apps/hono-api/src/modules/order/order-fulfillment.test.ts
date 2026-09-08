import { beforeEach, describe, expect, it, vi } from "vitest";

type OrderRecord = {
	id: string;
	owner_id: string;
	payment_status: string;
	total_amount_cents: number;
};

const created: {
	subscriptions: Record<string, unknown>[];
	entitlementLogs: Record<string, unknown>[];
	statusEvents: Record<string, unknown>[];
} = { subscriptions: [], entitlementLogs: [], statusEvents: [] };

function buildTx(orders: OrderRecord[]) {
	return {
		orders: {
			updateMany: vi.fn(async ({ where }: { where: { id: string; owner_id: string; payment_status: { not: string } } }) => {
				const order = orders.find((row) => row.id === where.id && row.owner_id === where.owner_id);
				if (!order || order.payment_status === "paid") return { count: 0 };
				order.payment_status = "paid";
				return { count: 1 };
			}),
		},
		order_status_events: {
			create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
				created.statusEvents.push(data);
				return data;
			}),
		},
		order_items: {
			findMany: vi.fn(async () => [
				{ id: "item-1", order_id: "order-1", product_id: "sys_membership_plus", sku_id: "sys_membership_plus-membership-monthly", title_snapshot: "PLUS", sku_name_snapshot: "月付", quantity: 1 },
			]),
		},
		order_entitlements: {
			findFirst: vi.fn(async () => created.entitlementLogs.length > 0 ? { id: "existing" } : null),
			create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
				created.entitlementLogs.push(data);
				return data;
			}),
		},
		product_entitlements: {
			findFirst: vi.fn(async ({ where }: { where: { product_id: string; entitlement_type: string } }) => {
				if (where.product_id === "sys_membership_plus") {
					return {
						product_id: "sys_membership_plus",
						entitlement_type: "membership",
						config_json: JSON.stringify({
							billingCycle: "monthly",
							durationDays: 30,
							monthlyCredits: 9900,
							dailyGiftCredits: 350,
							concurrencyLimit: 6,
							capacityLabel: "",
							timezone: "Asia/Shanghai",
							skuConfigs: {
								"sys_membership_plus-membership-monthly": {
									billingCycle: "monthly",
									durationDays: 30,
									monthlyCredits: 9900,
									dailyGiftCredits: 350,
									concurrencyLimit: 6,
									capacityLabel: "",
									timezone: "Asia/Shanghai",
								},
							},
						}),
					};
				}
				return null;
			}),
		},
		subscriptions: {
			updateMany: vi.fn(async () => ({ count: 1 })),
			create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
				created.subscriptions.push(data);
				return data;
			}),
		},
	};
}

const state = { orders: [] as OrderRecord[], tx: buildTx([]) };

vi.mock("../../platform/node/prisma", () => ({
	getPrismaClient: () => ({
		$transaction: async (fn: (tx: typeof state.tx) => Promise<void>) => fn(state.tx),
	}),
}));

vi.mock("../team/team.service", () => ({
	ensurePersonalBillingTeam: vi.fn(async () => "personal_u1"),
}));

vi.mock("../commerce/membership-credit.service", () => ({
	grantInitialMembershipCredits: vi.fn(async () => undefined),
}));

import { fulfillPaidMembershipOrder } from "./order-fulfillment";

describe("fulfillPaidMembershipOrder", () => {
	beforeEach(() => {
		created.subscriptions.length = 0;
		created.entitlementLogs.length = 0;
		created.statusEvents.length = 0;
		state.orders = [{ id: "order-1", owner_id: "u1", payment_status: "unpaid", total_amount_cents: 8900 }];
		state.tx = buildTx(state.orders);
	});

	it("marks the order paid, opens a membership subscription and records the entitlement", async () => {
		await fulfillPaidMembershipOrder({} as never, {
			ownerId: "u1",
			orderId: "order-1",
			paidAmountCents: 8900,
			previousStatus: "pending_payment",
			paymentPayload: { source: "wechat_callback" },
		});

		expect(created.statusEvents).toHaveLength(1);
		expect(created.subscriptions).toHaveLength(1);
		expect(created.subscriptions[0]).toMatchObject({
			owner_id: "u1",
			plan_code: "membership:sys_membership_plus:sys_membership_plus-membership-monthly",
			source_order_id: "order-1",
			status: "active",
			monthly_credits: 9900,
			daily_gift_credits: 350,
			credit_grant_count: 1,
		});
		expect(created.entitlementLogs).toHaveLength(1);
		expect(created.entitlementLogs[0]).toMatchObject({ status: "applied", entitlement_type: "membership" });
	});

	it("is a no-op when the order is already paid (duplicate callback)", async () => {
		state.orders[0].payment_status = "paid";
		await fulfillPaidMembershipOrder({} as never, {
			ownerId: "u1",
			orderId: "order-1",
			paidAmountCents: 8900,
			previousStatus: "pending_payment",
			paymentPayload: {},
		});

		expect(created.subscriptions).toHaveLength(0);
		expect(created.statusEvents).toHaveLength(0);
		expect(created.entitlementLogs).toHaveLength(0);
	});

	it("records a skipped entitlement without opening a subscription when the product has no membership entitlement", async () => {
		state.orders = [{ id: "order-1", owner_id: "u1", payment_status: "unpaid", total_amount_cents: 8900 }];
		state.tx = buildTx(state.orders);
		state.tx.order_items.findMany.mockResolvedValue([
			{ id: "item-1", order_id: "order-1", product_id: "unknown_product", sku_id: null, title_snapshot: "X", sku_name_snapshot: null, quantity: 1 },
		]);

		await fulfillPaidMembershipOrder({} as never, {
			ownerId: "u1",
			orderId: "order-1",
			paidAmountCents: 8900,
			previousStatus: "pending_payment",
			paymentPayload: {},
		});

		expect(created.subscriptions).toHaveLength(0);
		expect(created.entitlementLogs).toHaveLength(1);
		expect(JSON.parse(String(created.entitlementLogs[0].result_json))).toEqual({ reason: "membership_entitlement_missing" });
	});
});
