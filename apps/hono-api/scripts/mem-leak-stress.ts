/**
 * 内存泄漏修复压力断言脚本（可复现验证）。
 *
 * 运行：
 *   node -r ts-node/register/transpile-only -r tsconfig-paths/register scripts/mem-leak-stress.ts
 *
 * 对四个已修复的内存容器做有界性压力断言：
 *   1. NodeDurableObjectNamespace —— 600 个 execution 实例（各含 ~100KB graph）后必须被 LRU 封顶。
 *   2. resilient-draft-store 内存层 —— 600 条 4KB draft 写入后必须被封顶在 500 条内。
 *   3. canvas-sse.manager —— 僵死连接（从不消费）吃 30MB 广播帧后必须被背压驱逐，
 *      且驱逐后继续广播不再向该连接入队（external 不再随广播量线性增长）。
 *   4. [mem] 打点函数（do/draftMem/sseConns）可用且数值与断言一致。
 *
 * 断言以"结构有界"为准（容器 size / 连接驱逐），external 绝对值受 GC 时机影响，仅作
 * 参考打印。任一断言失败退出码为 1，可作为部署前回归门禁。
 */
import { appendFileSync, writeFileSync } from "node:fs";

import { NodeDurableObjectNamespace, nodeDurableInstanceCount } from "../src/platform/node/node-durable";
import {
	resilientDraftSet,
	resilientDraftMemorySize,
	resetResilientDraftStoreForTests,
} from "../src/modules/task/video-orchestrator.resilient-draft-store";
import {
	subscribeToChapter,
	broadcastPatch,
	countChapterConns,
	countAllCanvasSseConns,
	SSE_STREAM_QUEUING_STRATEGY,
} from "../src/modules/chapter/canvas-sse.manager";

// 关闭 draft store 的 durable(Prisma) 层与 redis 层：本脚本只验证内存层行为，不依赖
// 数据库/redis（.env 自动加载链会在 import 阶段注入 REDIS_URL，删除须在 import 之后）。
process.env.NODE_ENV = "test";
delete process.env.VIDEO_DRAFT_DURABLE_TEST;
delete process.env.REDIS_URL;

const mb = (bytes: number): number => Math.round(bytes / 1024 / 1024);
const memLine = (): string => {
	const m = process.memoryUsage();
	return `rss=${mb(m.rss)}MB ext=${mb(m.external)}MB arrayBuffers=${mb(m.arrayBuffers)}MB heap=${mb(m.heapUsed)}MB`;
};

const REPORT = "stress-report.txt";
writeFileSync(REPORT, "");
const report = (line: string): void => {
	// stdout 在重定向/管道下会被 process.exit 丢弃缓冲，双写文件保证结果可读。
	console.log(line);
	appendFileSync(REPORT, `${line}\n`);
};

let failed = 0;
function assert(condition: boolean, label: string, detail: string): void {
	const verdict = condition ? "PASS" : "FAIL";
	if (!condition) failed += 1;
	report(`[stress] ${verdict} ${label} — ${detail}`);
}

function stalledController(): { controller: ReadableStreamDefaultController; errored: () => boolean } {
	let captured: ReadableStreamDefaultController | null = null;
	let errorSignaled = false;
	const stream = new ReadableStream({
		start(controller) { captured = controller; },
	}, SSE_STREAM_QUEUING_STRATEGY);
	void stream.getReader().closed.catch(() => { errorSignaled = true; });
	return {
		controller: captured as unknown as ReadableStreamDefaultController,
		errored: () => errorSignaled,
	};
}

async function main(): Promise<void> {
	report(`[stress] start ${memLine()}`);

	// ── 1) DO 实例 LRU 封顶 ────────────────────────────────────────────────
	{
		const before = process.memoryUsage().arrayBuffers;
		const ns = new NodeDurableObjectNamespace(
			({ id, state }) => {
				void state.storage.put("graph", {
					executionId: id,
					nodes: Array.from({ length: 200 }, (_, i) => ({ id: `${id}-n${i}`, data: "x".repeat(512) })),
				});
				return { fetch: async () => new Response("ok") };
			},
			{ maxInstances: 50 },
		);
		for (let i = 0; i < 600; i += 1) ns.get(ns.idFromName(`exec-${i}`));
		assert(
			ns.size() <= 50,
			"DO 实例 LRU 封顶",
			`600 次 get 后 size=${ns.size()}（上限 50）；ext 增量=${mb(process.memoryUsage().arrayBuffers - before)}MB`,
		);
	}

	// ── 2) draft store 内存层封顶 ──────────────────────────────────────────
	{
		resetResilientDraftStoreForTests();
		for (let i = 0; i < 600; i += 1) {
			await resilientDraftSet(`stress-key-${i}`, JSON.stringify({ blob: "x".repeat(4096) }), 3600);
		}
		assert(
			resilientDraftMemorySize() <= 500,
			"draft store 内存层封顶",
			`600 条写入后 size=${resilientDraftMemorySize()}（上限 500）`,
		);
	}

	// ── 3) SSE 僵死连接背压驱逐 ────────────────────────────────────────────
	{
		const room = "stress-stalled-room";
		const stalled = stalledController();
		const sub = subscribeToChapter(room, "stress-user", stalled.controller);
		const before = process.memoryUsage().arrayBuffers;

		// 60 帧 × ~512KB ≈ 30MB：超过 HWM(1MB)+MAX(4MB)，必须在中途被驱逐
		const bigNode = { id: "n", data: { kind: "text", blob: "x".repeat(512 * 1024) } };
		for (let i = 0; i < 60 && countChapterConns(room) > 0; i += 1) {
			broadcastPatch(room, { upsertNodes: [bigNode] }, "");
		}
		const evicted = countChapterConns(room) === 0;
		// controller.error() 的 reject 异步送达 reader.closed
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert(evicted && stalled.errored(), "僵死 SSE 连接被背压驱逐", `30MB 广播后 conns=${countChapterConns(room)} errored=${stalled.errored()}`);

		// 驱逐后继续广播 100 帧（~50MB）：不应再向任何连接入队，external 不得线性增长
		const afterEviction = process.memoryUsage().arrayBuffers;
		for (let i = 0; i < 100; i += 1) {
			broadcastPatch(room, { upsertNodes: [bigNode] }, "");
		}
		const growth = process.memoryUsage().arrayBuffers - afterEviction;
		assert(
			growth < 20 * 1024 * 1024,
			"驱逐后继续广播不积压",
			`再广播 ~50MB 后 ext 增量=${mb(growth)}MB（GC 前的瞬时垃圾计入，但不得接近广播量）`,
		);
		assert(
			countAllCanvasSseConns() === 0,
			"连接注册表已清空",
			`sseConns=${countAllCanvasSseConns()}`,
		);
		sub.unsubscribe();
	}

	// ── 4) [mem] 打点可用 ──────────────────────────────────────────────────
	{
		assert(
			typeof nodeDurableInstanceCount() === "number"
			&& typeof resilientDraftMemorySize() === "number"
			&& typeof countAllCanvasSseConns() === "number",
			"[mem] 打点函数可用",
			`do=${nodeDurableInstanceCount()} draftMem=${resilientDraftMemorySize()} sseConns=${countAllCanvasSseConns()}`,
		);
	}

	report(`[stress] end ${memLine()}`);
	if (failed > 0) {
		report(`[stress] ${failed} assertion(s) FAILED`);
	}
	report(failed > 0 ? "[stress] FAILED" : "[stress] all assertions passed");
	// SSE 心跳 setInterval 会挂住事件循环，报告已同步落盘，直接退出。
	process.exit(failed);
}

void main().catch((error: unknown) => {
	console.error("[stress] crashed", error);
	process.exit(1);
});
