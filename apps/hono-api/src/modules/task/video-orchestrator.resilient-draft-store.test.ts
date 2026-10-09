import { beforeEach, describe, expect, it } from "vitest";
import { resilientDraftSet, resilientDraftMemorySize, resetResilientDraftStoreForTests } from "./video-orchestrator.resilient-draft-store";

// 强制隔离外部环境：durableStoreEnabled 按调用时环境判断；.env 自动加载链（@prisma/client）
// 会在 import 阶段注入 REDIS_URL，导致每次写入真连本地 redis（~26ms/次，600 次即超时）。
// 本组用例只验证内存层行为，必须在每个用例前清掉外部连接通道。
process.env.NODE_ENV = "test";
delete process.env.VIDEO_DRAFT_DURABLE_TEST;

// NODE_ENV=test 下 durable（Prisma）层自动禁用（durableStoreEnabled），本组用例只验证
// 内存层的封顶与过期清理行为。
describe("resilient-draft-store 内存层封顶（内存泄漏防线）", () => {
	beforeEach(() => {
		delete process.env.REDIS_URL;
		resetResilientDraftStoreForTests();
	});

	it("超过 MAX_MEMORY_ENTRIES(500) 时淘汰最旧条目，size 恒有界", async () => {
		for (let i = 0; i < 600; i += 1) {
			await resilientDraftSet(`cap-key-${i}`, JSON.stringify({ blob: "x".repeat(1024) }), 3600);
		}
		expect(resilientDraftMemorySize()).toBeLessThanOrEqual(500);
		expect(resilientDraftMemorySize()).toBeGreaterThan(0);
	});

	it("过期条目在下一次写入时被清理，不残留", async () => {
		await resilientDraftSet("ttl-expiring", "\"v\"", 1);
		await new Promise((resolve) => setTimeout(resolve, 1100));
		await resilientDraftSet("ttl-fresh", "\"v\"", 3600);
		expect(resilientDraftMemorySize()).toBe(1);
	});
});
