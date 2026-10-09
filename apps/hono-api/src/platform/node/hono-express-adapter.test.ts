import { describe, expect, it, vi } from "vitest";
import { mountHonoToExpress } from "./hono-express-adapter";

type TestRequest = {
	headers: Record<string, string>;
	method: string;
	url: string;
};

type TestResponse = {
	statusCode: number;
	headersSent: boolean;
	writableEnded: boolean;
	headerCalls: number;
	setHeader: (name: string, value: string | string[]) => void;
	end: (chunk?: string) => void;
	on: (
		event: "error" | "close" | "finish",
		listener: (error?: Error) => void,
	) => void;
};

describe("mountHonoToExpress", () => {
	it("does not attempt a second response after headers were already sent", async () => {
		let handler:
			| ((req: TestRequest, res: TestResponse) => Promise<void>)
			| undefined;
		const expressApp = {
			use(next: (req: TestRequest, res: TestResponse) => Promise<void>) {
				handler = next;
			},
		};
		const honoApp = {
			fetch: () =>
				new Response(JSON.stringify({ success: true }), {
					status: 200,
					headers: {
						"x-first-header": "ok",
						"content-type": "application/json; charset=utf-8",
					},
				}),
		};
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

		mountHonoToExpress(expressApp, honoApp, {});

		const res: TestResponse = {
			statusCode: 0,
			headersSent: false,
			writableEnded: false,
			headerCalls: 0,
			setHeader() {
				this.headerCalls += 1;
				if (this.headerCalls === 1) {
					this.headersSent = true;
					return;
				}
				throw new Error("Cannot set headers after they are sent to the client");
			},
			end() {
				this.writableEnded = true;
			},
			on() {
				return;
			},
		};

		await handler?.(
			{
				headers: { host: "localhost" },
				method: "GET",
				url: "/auth/login",
			},
			res,
		);

		expect(res.headerCalls).toBe(2);
		expect(errorSpy).toHaveBeenCalledWith(
			"[api] response failed after headers sent",
			expect.any(Error),
		);

		errorSpy.mockRestore();
	});
});

describe("request signal bridging（SSE 僵尸 conn 防线）", () => {
	function setup() {
		let handler: ((req: unknown, res: unknown) => Promise<void>) | undefined;
		const expressApp = {
			use(next: (req: unknown, res: unknown) => Promise<void>) {
				handler = next;
			},
		};
		let capturedSignal: AbortSignal | null = null;
		const honoApp = {
			fetch: (request: Request) => {
				capturedSignal = request.signal;
				// 模拟 SSE：永不结束的响应体
				return new Response(new ReadableStream({ start() { /* never ends */ } }), { status: 200 });
			},
		};
		const closeListeners: Array<() => void> = [];
		const res = {
			statusCode: 0,
			headersSent: false,
			writableEnded: false,
			setHeader() { /* noop */ },
			end(chunk?: string) {
				this.writableEnded = true;
				void chunk;
			},
			on(event: string, listener: (error?: Error) => void) {
				if (event === "close") closeListeners.push(listener);
			},
			// 最小 Writable 面貌：pipe 需要 once/emit/write，缺失会让 pipe 抛错，
			// handler 走 500 分支调 end() 污染 writableEnded，破坏用例前提。
			once() { /* noop */ },
			removeListener() { /* noop */ },
			emit() { return true; },
			write() { return true; },
			pipe() { return this; },
		};
		mountHonoToExpress(expressApp as never, honoApp as never, {});
		return {
			handler: handler as (req: unknown, res: unknown) => Promise<void>,
			get signal() { return capturedSignal; },
			closeListeners,
			res: res as { writableEnded: boolean },
		};
	}

	it("客户端提前断开（未写完就 close）→ request signal 必须 abort", async () => {
		const t = setup();
		void t.handler({ headers: { host: "localhost" }, method: "GET", url: "/chapters/x/canvas-events" }, t.res).catch(() => undefined);
		await new Promise((resolve) => setTimeout(resolve, 10));

		expect(t.signal).toBeTruthy();
		expect(t.signal!.aborted).toBe(false);
		for (const listener of t.closeListeners) listener();
		expect(t.signal!.aborted).toBe(true);
	});

	it("响应正常结束（writableEnded）→ close 不 abort", async () => {
		const t = setup();
		void t.handler({ headers: { host: "localhost" }, method: "GET", url: "/normal" }, t.res).catch(() => undefined);
		await new Promise((resolve) => setTimeout(resolve, 10));

		t.res.writableEnded = true;
		for (const listener of t.closeListeners) listener();
		expect(t.signal!.aborted).toBe(false);
	});
});
