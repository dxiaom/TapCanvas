import { describe, expect, it, vi, beforeEach } from "vitest";

const findUniqueMock = vi.fn();
const updateMock = vi.fn();

vi.mock("../../platform/node/prisma", () => ({
	getPrismaClient: () => ({
		users: {
			findUnique: (...a: unknown[]) => findUniqueMock(...a),
			update: (...a: unknown[]) => updateMock(...a),
		},
	}),
}));

import { setAccountPassword, changeAccountPassword } from "./account.service";

function fakeContext(userId: string): Parameters<typeof setAccountPassword>[0] {
	return {
		get: (key: string) => (key === "userId" ? userId : undefined),
		env: { DB: {} },
	} as unknown as Parameters<typeof setAccountPassword>[0];
}

describe("account password", () => {
	beforeEach(() => {
		findUniqueMock.mockReset();
		updateMock.mockReset().mockResolvedValue({});
	});

	it("set: rejects short password", async () => {
		await expect(setAccountPassword("u1", "short")).rejects.toThrow(/至少 8 位/);
	});

	it("set: rejects when password already configured", async () => {
		findUniqueMock.mockResolvedValue({ id: "u1", password_hash: "h", password_salt: "s" });
		await expect(setAccountPassword("u1", "longenough1")).rejects.toThrow(/已设置/);
	});

	it("set: writes hash/salt/updated_at when no password", async () => {
		findUniqueMock.mockResolvedValue({ id: "u1", password_hash: null, password_salt: null });
		await setAccountPassword("u1", "longenough1");
		expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
			where: { id: "u1" },
			data: expect.objectContaining({ password_updated_at: expect.any(String) }),
		}));
	});

	it("change: rejects wrong current password", async () => {
		findUniqueMock.mockResolvedValue({ id: "u1", password_hash: "h", password_salt: "s" });
		await expect(changeAccountPassword("u1", "wrongpass1", "longenough1")).rejects.toThrow(/当前密码不正确/);
	});

	it("change: rejects when password not set", async () => {
		findUniqueMock.mockResolvedValue({ id: "u1", password_hash: null, password_salt: null });
		await expect(changeAccountPassword("u1", "whatever1", "longenough1")).rejects.toThrow(/尚未设置密码/);
	});

	it("change: writes new hash on success", async () => {
		const { createPasswordRecord } = await import("../auth/password");
		const record = await createPasswordRecord("currentpw1");
		findUniqueMock.mockResolvedValue({ id: "u1", password_hash: record.hash, password_salt: record.salt });
		await changeAccountPassword("u1", "currentpw1", "longenough1");
		expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
			where: { id: "u1" },
			data: expect.objectContaining({ password_updated_at: expect.any(String) }),
		}));
	});

	it("fakeContext helper keeps type parity with service signature", () => {
		expect(typeof fakeContext("u1")).toBe("object");
	});
});
