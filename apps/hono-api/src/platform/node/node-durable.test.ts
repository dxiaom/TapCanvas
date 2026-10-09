import { describe, expect, it } from "vitest";
import { NodeDurableObjectNamespace, nodeDurableInstanceCount } from "./node-durable";

function makeCountingFactory() {
	let created = 0;
	return {
		createdCount: () => created,
		factory: ({ id }: { id: string }) => {
			created += 1;
			return {
				fetch: async () => new Response(`do:${id}`),
			};
		},
	};
}

describe("NodeDurableObjectNamespace 实例淘汰（内存泄漏防线）", () => {
	it("超过 maxInstances 时按 LRU 淘汰最久未访问的实例", async () => {
		const { factory, createdCount } = makeCountingFactory();
		const ns = new NodeDurableObjectNamespace(factory, { maxInstances: 2 });

		ns.get(ns.idFromName("exec-a"));
		await new Promise((resolve) => setTimeout(resolve, 2));
		ns.get(ns.idFromName("exec-b"));
		await new Promise((resolve) => setTimeout(resolve, 2));
		expect(ns.size()).toBe(2);

		// 触达 a 使其比 b 更新，再创建 c → b 应被淘汰（毫秒间隔保证 lastAccess 严格可分）
		ns.get(ns.idFromName("exec-a"));
		await new Promise((resolve) => setTimeout(resolve, 2));
		ns.get(ns.idFromName("exec-c"));
		expect(ns.size()).toBe(2);
		expect(createdCount()).toBe(3);

		// b 被淘汰后再次 get 会创建新实例（等价于重启后从持久化事实恢复）
		ns.get(ns.idFromName("exec-b"));
		expect(createdCount()).toBe(4);
		expect(ns.size()).toBe(2);
	});

	it("空闲超过 idleTtlMs 的实例被 sweep 驱逐", async () => {
		const { factory, createdCount } = makeCountingFactory();
		const ns = new NodeDurableObjectNamespace(factory, { maxInstances: 100, idleTtlMs: 20 });

		ns.get(ns.idFromName("exec-idle"));
		expect(ns.size()).toBe(1);

		await new Promise((resolve) => setTimeout(resolve, 40));
		const evicted = ns.sweep();
		expect(evicted).toBe(1);
		expect(ns.size()).toBe(0);

		// 重新 get 创建全新实例
		ns.get(ns.idFromName("exec-idle"));
		expect(createdCount()).toBe(2);
	});

	it("最近访问的实例不会被空闲驱逐误删（lastAccess 刷新生效）", async () => {
		const { factory } = makeCountingFactory();
		const ns = new NodeDurableObjectNamespace(factory, { maxInstances: 100, idleTtlMs: 30 });

		ns.get(ns.idFromName("exec-old"));
		await new Promise((resolve) => setTimeout(resolve, 40));
		ns.get(ns.idFromName("exec-old")); // 刷新 lastAccess
		ns.sweep();
		expect(ns.size()).toBe(1);
	});

	it("nodeDurableInstanceCount 汇总所有存活 namespace 的实例数", () => {
		const { factory } = makeCountingFactory();
		const ns = new NodeDurableObjectNamespace(factory, { maxInstances: 10 });
		const before = nodeDurableInstanceCount();
		ns.get(ns.idFromName("exec-count-1"));
		ns.get(ns.idFromName("exec-count-2"));
		expect(nodeDurableInstanceCount()).toBe(before + 2);
	});
});
