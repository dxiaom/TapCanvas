import { Readable } from "node:stream";

type HonoLike = {
	fetch: (req: Request, env?: unknown, ctx?: unknown) => Promise<Response> | Response;
};

type ExpressLikeRequest = {
	headers?: Record<string, string | string[] | undefined>;
	protocol?: string;
	originalUrl?: string;
	url?: string;
	method?: string;
};

type ExpressLikeResponse = {
	statusCode: number;
	headersSent?: boolean;
	writableEnded?: boolean;
	setHeader: (name: string, value: string | string[]) => void;
	end: (chunk?: string) => void;
	on: (
		event: "error" | "close" | "finish",
		listener: (error?: Error) => void,
	) => void;
};

function hasResponseStarted(res: ExpressLikeResponse): boolean {
	return Boolean(res.headersSent || res.writableEnded);
}

function buildRequestFromExpress(req: ExpressLikeRequest, res: ExpressLikeResponse): Request {
	const host = String(req.headers?.host || "localhost");
	const proto = String(req.protocol || "http");
	const url = new URL(String(req.originalUrl || req.url || "/"), `${proto}://${host}`);

	const headers = new Headers();
	for (const [key, value] of Object.entries(req.headers || {})) {
		if (typeof value === "undefined") continue;
		if (Array.isArray(value)) {
			value.forEach((v) => headers.append(key, String(v)));
			continue;
		}
		headers.set(key, String(value));
	}

	const method = String(req.method || "GET").toUpperCase();
	const hasBody = !(method === "GET" || method === "HEAD");
	const body = hasBody ? Readable.toWeb(req as never) : undefined;

	// 桥接客户端断开 → hono request signal。SSE 等长连接路由依赖
	// `c.req.raw.signal` 的 abort 做连接清理（unsubscribe）；不桥接的话该 signal
	// 永不触发，断开的客户端会在 SSE 注册表里累积成僵尸 conn（实测 ~3/min）。
	// 判定标准：响应未正常写完（!writableEnded）就 close = 客户端提前断开。
	const abortController = new AbortController();
	res.on("close", () => {
		if (!res.writableEnded) abortController.abort();
	});

	return new Request(url, {
		method,
		headers,
		body,
		signal: abortController.signal,
		// Required by Node fetch when the body is a stream.
		...(hasBody ? { duplex: "half" as any } : {}),
	});
}

async function writeResponseToExpress(
	res: ExpressLikeResponse,
	response: Response,
): Promise<void> {
	res.statusCode = response.status;

	const setCookies =
		typeof (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie ===
		"function"
			? (
					response.headers as Headers & {
						getSetCookie: () => string[];
					}
				).getSetCookie()
			: [];
	if (Array.isArray(setCookies) && setCookies.length) {
		res.setHeader("Set-Cookie", setCookies);
	}

	response.headers.forEach((value, key) => {
		if (key.toLowerCase() === "set-cookie") return;
		res.setHeader(key, value);
	});

	if (!response.body) {
		res.end();
		return;
	}

	const nodeStream = Readable.fromWeb(response.body as never);
	// 客户端提前断开时立即停止消费响应体：销毁 nodeStream 会 cancel 底层 web 流，
	// 让 SSE controller 后续 enqueue 抛错 → SSE 注册表即时移除该连接（与 signal abort 双保险）。
	res.on("close", () => {
		if (!res.writableEnded) nodeStream.destroy();
	});
	await new Promise<void>((resolve, reject) => {
		nodeStream.on("error", reject);
		res.on("error", reject);
		res.on("close", resolve);
		res.on("finish", resolve);
		nodeStream.pipe(res);
	});
}

export function mountHonoToExpress(
	expressApp: { use: (handler: (req: ExpressLikeRequest, res: ExpressLikeResponse) => Promise<void>) => void },
	honoApp: HonoLike,
	env: unknown,
): void {
	// Delegate everything to Hono (keep existing routes/OpenAPI/docs intact).
	expressApp.use(async (req: ExpressLikeRequest, res: ExpressLikeResponse) => {
		try {
			const request = buildRequestFromExpress(req, res);
			const ctx = {
				waitUntil: (p: Promise<unknown>) => {
					p.catch((err) => {
						// eslint-disable-next-line no-console
						console.warn("[api] waitUntil rejected", err);
					});
				},
			};
			const response = await honoApp.fetch(request, env, ctx);
			await writeResponseToExpress(res, response);
		} catch (err) {
			// If headers/body were already started, the original error must be logged,
			// but we must not try to send a second response.
			if (hasResponseStarted(res)) {
				// eslint-disable-next-line no-console
				console.error("[api] response failed after headers sent", err);
				return;
			}
			res.statusCode = 500;
			res.setHeader("Content-Type", "application/json; charset=utf-8");
			res.end(
				JSON.stringify({
					error: "internal_error",
					message: err instanceof Error ? err.message : String(err),
				}),
			);
		}
	});
}
