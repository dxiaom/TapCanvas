import { Hono } from "hono";
import type { AppEnv } from "../../types";
import { ProductListResponseSchema } from "../product/product.schemas";
import { listProductsForCatalog } from "../product/product.service";

/**
 * 免登录的个人会员套餐目录：公开定价页（/pricing）的数据源。
 * 只暴露 active 的 membership 商品，不暴露草稿/下架商品与管理字段。
 */
export const membershipPublicRouter = new Hono<AppEnv>();

membershipPublicRouter.get("/plans", async (c) => {
	const data = await listProductsForCatalog(c, {
		status: "active",
		entitlementType: "membership",
		page: 1,
		size: 50,
	});
	return c.json(ProductListResponseSchema.parse(data));
});
