import type IORedis from "ioredis";

export class OtpRateLimitError extends Error {
	readonly status = 429;
	constructor(message: string, readonly retryAfterSeconds: number) {
		super(message);
	}
}

export class OtpVerifyLockedError extends OtpRateLimitError {
	constructor(readonly lockSeconds: number) {
		super(`验证码错误次数过多，请 ${Math.ceil(lockSeconds / 60)} 分钟后再试`, lockSeconds);
	}
}

export class OtpRateLimitUnavailableError extends Error {
	readonly status = 503;
	constructor() {
		super("限流服务暂不可用，请稍后再试");
	}
}

const SEND_WINDOW_60S = 60;
const SEND_HOURLY_MAX = 10;
const SEND_IP_HOURLY_MAX = 30;
const VERIFY_FAIL_MAX = 5;
const VERIFY_LOCK_SECONDS = 900;

export async function checkOtpSendLimit(opts: {
	redis: IORedis;
	emailHash: string;
	clientIp: string | null;
}): Promise<void> {
	const { redis, emailHash, clientIp } = opts;
	const counters: Array<{ key: string; max: number; windowSeconds: number; message: string }> = [
		{ key: `otp:send:60s:${emailHash}`, max: 1, windowSeconds: SEND_WINDOW_60S, message: "发送太频繁，请 1 分钟后再试" },
		{ key: `otp:send:hour:${emailHash}`, max: SEND_HOURLY_MAX, windowSeconds: 3600, message: "该邮箱今日验证码发送次数已达上限" },
	];
	if (clientIp) {
		counters.push({ key: `otp:send:ip-hour:${clientIp}`, max: SEND_IP_HOURLY_MAX, windowSeconds: 3600, message: "当前网络发送次数已达上限，请稍后再试" });
	}
	try {
		for (const counter of counters) {
			const next = await redis.incr(counter.key);
			if (next === 1) await redis.expire(counter.key, counter.windowSeconds);
			if (next > counter.max) {
				throw new OtpRateLimitError(counter.message, counter.windowSeconds);
			}
		}
	} catch (err) {
		if (err instanceof OtpRateLimitError) throw err;
		throw new OtpRateLimitUnavailableError();
	}
}

export async function recordOtpVerifyResult(opts: {
	redis: IORedis;
	emailHash: string;
	ok: boolean;
}): Promise<void> {
	const { redis, emailHash, ok } = opts;
	const key = `otp:fail:${emailHash}`;
	try {
		if (ok) {
			await redis.del(key);
			return;
		}
		const next = await redis.incr(key);
		if (next === 1) await redis.expire(key, VERIFY_LOCK_SECONDS);
		if (next >= VERIFY_FAIL_MAX) throw new OtpVerifyLockedError(VERIFY_LOCK_SECONDS);
	} catch (err) {
		if (err instanceof OtpRateLimitError) throw err;
		throw new OtpRateLimitUnavailableError();
	}
}
