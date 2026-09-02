import { describe, expect, it, vi, beforeEach } from "vitest";

const topUpMock = vi.fn();
const getConfigMock = vi.fn();

vi.mock("../team/team.repo", () => ({
	topUpTeamCredits: (...args: unknown[]) => topUpMock(...args),
}));
vi.mock("./referral.repo", () => ({
	getReferralConfig: (...args: unknown[]) => getConfigMock(...args),
}));

import { grantRegistrationWelcomeCredits } from "./referral.service";

function fakeContext(): Parameters<typeof grantRegistrationWelcomeCredits>[0] {
	return { env: { DB: {} } } as unknown as Parameters<typeof grantRegistrationWelcomeCredits>[0];
}

describe("grantRegistrationWelcomeCredits", () => {
	beforeEach(() => {
		topUpMock.mockReset().mockResolvedValue({ team: {}, ledgerEntryId: "ledger_1" });
		getConfigMock.mockReset().mockResolvedValue({ registration_welcome_credits: 100 });
	});

	it("no refCode grants with idempotent taskId", async () => {
		await grantRegistrationWelcomeCredits(fakeContext(), "u1", null);
		expect(topUpMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
			teamId: "personal_u1",
			amount: 100,
			taskId: "registration-welcome:u1",
			entryType: "registration_welcome",
		}));
	});

	it("valid-format refCode skips plain grant (referral path owns credits)", async () => {
		await grantRegistrationWelcomeCredits(fakeContext(), "u1", "ABCD23");
		expect(topUpMock).not.toHaveBeenCalled();
	});

	it("amount 0 grants nothing", async () => {
		getConfigMock.mockResolvedValue({ registration_welcome_credits: 0 });
		await grantRegistrationWelcomeCredits(fakeContext(), "u1", null);
		expect(topUpMock).not.toHaveBeenCalled();
	});

	it("topUp returning no ledgerEntryId throws explicitly", async () => {
		topUpMock.mockResolvedValue({ team: {}, ledgerEntryId: null });
		await expect(grantRegistrationWelcomeCredits(fakeContext(), "u1", null)).rejects.toThrow(/ledger missing/);
	});
});
