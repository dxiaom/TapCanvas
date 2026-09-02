import { describe, expect, it, vi, beforeEach } from "vitest";
import type IORedis from "ioredis";

function fakeRedis(): IORedis {
	return {
		incr: vi.fn(async (..._a: unknown[]) => 1),
		expire: vi.fn(async (..._a: unknown[]) => 1),
		del: vi.fn(async (..._a: unknown[]) => 1),
		get: vi.fn(async (..._a: unknown[]) => null),
	} as unknown as IORedis;
}

import {
	checkOtpSendLimit,
	recordOtpVerifyResult,
	OtpRateLimitError,
	OtpVerifyLockedError,
} from "./otp-rate-limit";

describe("otp rate limit", () => {
	beforeEach(() => vi.restoreAllMocks());

	it("first send passes and sets 60s + hourly counters", async () => {
		const redis = fakeRedis();
		const incr = redis.incr as ReturnType<typeof vi.fn>;
		incr.mockResolvedValue(1);
		await expect(checkOtpSendLimit({ redis, emailHash: "e1", clientIp: "1.2.3.4" })).resolves.toBeUndefined();
		expect(incr).toHaveBeenCalledTimes(3);
	});

	it("second send within 60s throws 429", async () => {
		const redis = fakeRedis();
		(redis.incr as ReturnType<typeof vi.fn>).mockImplementation(async (key: unknown) =>
			String(key).includes(":60s:") ? 2 : 1,
		);
		await expect(checkOtpSendLimit({ redis, emailHash: "e1", clientIp: null })).rejects.toBeInstanceOf(OtpRateLimitError);
	});

	it("11th hourly send throws 429", async () => {
		const redis = fakeRedis();
		(redis.incr as ReturnType<typeof vi.fn>).mockImplementation(async (key: unknown) =>
			String(key).includes(":hour:") ? 11 : 1,
		);
		await expect(checkOtpSendLimit({ redis, emailHash: "e1", clientIp: null })).rejects.toBeInstanceOf(OtpRateLimitError);
	});

	it("5th verify failure locks", async () => {
		const redis = fakeRedis();
		(redis.incr as ReturnType<typeof vi.fn>).mockResolvedValue(5);
		await expect(recordOtpVerifyResult({ redis, emailHash: "e1", ok: false })).rejects.toBeInstanceOf(OtpVerifyLockedError);
	});

	it("verify success clears fail counter", async () => {
		const redis = fakeRedis();
		await recordOtpVerifyResult({ redis, emailHash: "e1", ok: true });
		expect(redis.del).toHaveBeenCalledWith("otp:fail:e1");
	});
});
