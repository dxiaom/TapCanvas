# 开放注册 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 TapCanvas 登录体系开放为公开商业产品注册：邮箱验证码（登录即注册）+ 注册赠送积分（可配）+ OTP 防滥用 + 可选密码，前端登录面板多 Tab 化。

**Architecture:** 复用现存链路——后端恢复被 410 的 email OTP 路由并补 Redis 限流；注册积分在 `persistLoginUser` 建档点发放（与邀请奖励互斥，复用 `topUpTeamCredits` 幂等）；密码走 account 模块新端点；前端把 `LoginForm` 重构为多 Tab 容器 + 三个子表单组件。

**Tech Stack:** Hono + Prisma(SQLite/Postgres 双兼容) + ioredis（限流）、Vitest、React + Mantine。

## Global Constraints

- 禁止 `any` 新增；测试/mock 处可用既有测试基建的既有模式
- 零静默兜底：Redis 不可用时限流显式 503；邮件未配置显式 501（现状保持）
- 邀请奖励与注册奖励互斥：请求头带合法格式邀请码时只走邀请链路
- 生产环境不显示默认管理员密码（`import.meta.env.DEV` 门控）
- git commit 步骤执行前需用户确认（仓库规则）
- 设计真源：`docs/superpowers/specs/2026-09-02-open-registration-design.md`

## 已核实的现状（实施者必读）

- 后端 email OTP service 完整：`auth.service.ts` `requestEmailLoginCode`(L449) / `verifyEmailLoginCode`(L521)，返回值可能是 `Response`（c.json 错误分支）或对象
- 前端 API 绑定完整：`server.ts` `requestEmailLoginCode`(L4908)、`verifyEmailLogin`(L4931)、`createWechatLoginSession`(L4965)、`getWechatLoginStatus`(L4980)、`consumeWechatLoginSession`(L4991)、GitHub exchange(L4888 附近)
- `loginWithCredentials`(auth.service L591) 已支持任何设过密码的用户（非仅管理员）
- `referral_config` 已有 `invitee_welcome_credits`（默认 1000）；`bindReferrerOnRegister`(referral.service L41) 用 `taskId: referral-welcome:${userId}` + `topUpTeamCredits` 幂等发放，teamId = `personal_${userId}`
- 用户表已有 `password_hash/password_salt/password_updated_at` 列；PBKDF2 助手在 `auth/password.ts`
- `email_login_codes` 表已在 schema.prisma（L328）
- Redis 单例：`src/platform/redis-shared.ts` `getSharedRedis(): IORedis | null`
- 登录 UI：`apps/web/src/auth/LoginForm.tsx`（当前单管理员表单）由 `LoginOverlay.tsx` 包裹，成功回调 `onLoginSuccess` 内 `setAuth + clearPendingRefCode`
- 管理端邀请配置 UI：`apps/web/src/promo/ReferralCampaignAdmin.tsx`（`update({invitee_welcome_credits})` 模式）
- 后端测试命令：`pnpm --filter ./apps/hono-api test`（vitest run）

---

### Task 1: referral_config 增加 registration_welcome_credits

**Files:**
- Modify: `apps/hono-api/prisma/schema.prisma`（referral_config model，约 L1304）
- Modify: `apps/hono-api/src/modules/referral/referral.repo.ts`（ReferralConfigRow 类型，L4-15）
- Modify: `apps/hono-api/src/modules/referral/referral.routes.ts`（ADMIN_PATCH_KEYS，L68-76）
- Modify: `apps/web/src/api/server.ts`（referral config DTO，L11075 附近）
- Modify: `apps/web/src/promo/ReferralCampaignAdmin.tsx`（管理表单，L129-145 SimpleGrid）

**Interfaces:**
- Produces: `ReferralConfigRow.registration_welcome_credits: number`（后续 Task 2 依赖）
- Produces: 管理端 PUT /referral/admin/config 可写 `registration_welcome_credits`

- [ ] **Step 1: schema.prisma referral_config 加列**

在 `invitee_welcome_credits Int @default(1000)` 下一行加：

```prisma
  registration_welcome_credits   Int     @default(100)
```

- [ ] **Step 2: repo 类型同步**

`referral.repo.ts` `ReferralConfigRow` 的 `invitee_welcome_credits: number;` 下一行加：

```ts
	registration_welcome_credits: number;
```

- [ ] **Step 3: 管理路由 PATCH 白名单**

`referral.routes.ts` `ADMIN_PATCH_KEYS` 数组中 `"invitee_welcome_credits",` 后加：

```ts
	"registration_welcome_credits",
```

- [ ] **Step 4: 前端 DTO 与管理表单**

`server.ts` L11075 的 referral config DTO 类型 `invitee_welcome_credits: number` 后加 `registration_welcome_credits: number`（该类型为后端配置行镜像，字段名保持 snake_case）。

`ReferralCampaignAdmin.tsx` SimpleGrid 中「受邀注册奖励」NumberInput 后加：

```tsx
        <NumberInput
          label="普通注册奖励（积分，0=关闭）"
          value={config.registration_welcome_credits}
          onChange={(v) => update({ registration_welcome_credits: Number(v) || 0 })}
        />
```

- [ ] **Step 5: 验证**

Run: `pnpm --filter ./apps/hono-api build`
Expected: 编译通过（schema 列变更的 DB 迁移在部署阶段执行 `db:pg:schema`）

- [ ] **Step 6: Commit**（需用户确认）

```
feat(referral): add configurable registration welcome credits
```

---

### Task 2: 注册赠送积分发放

**Files:**
- Modify: `apps/hono-api/src/modules/referral/referral.service.ts`（新增 export 函数）
- Modify: `apps/hono-api/src/modules/auth/auth.service.ts`（persistLoginUser created 分支，L118-129）
- Test: `apps/hono-api/src/modules/referral/registration-welcome.test.ts`（新建，mock prisma/repo 模式参照 `src/modules/auth/auth.service.test.ts`）

**Interfaces:**
- Consumes: `ReferralConfigRow.registration_welcome_credits`（Task 1）
- Consumes: `topUpTeamCredits(db, input)`（team.repo L888，返回 `{team, ledgerEntryId}`）
- Consumes: `repo.getReferralConfig(db)`
- Produces: `grantRegistrationWelcomeCredits(c: AppContext, userId: string, refCode: string | null): Promise<void>`，在 `persistLoginUser` created 分支调用

- [ ] **Step 1: 写失败测试**

`registration-welcome.test.ts` 核心 case（mock `team.repo.topUpTeamCredits` 与 `./referral.repo`）：

```ts
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
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter ./apps/hono-api test -- src/modules/referral/registration-welcome.test.ts`
Expected: FAIL（grantRegistrationWelcomeCredits 未导出）

- [ ] **Step 3: 实现**

`referral.service.ts` 顶部 import 已有 `topUpTeamCredits`、`* as repo`。文件末尾追加：

```ts
const INVITE_CODE_FORMAT = /^[A-HJ-NP-Z2-9]{6}$/;

/**
 * 无邀请码注册的欢迎积分（与邀请奖励互斥：请求携带合法格式邀请码时，
 * 积分由 bindReferrerOnRegister 的 referral-welcome 链路负责，这里直接跳过）。
 * 幂等依赖 topUpTeamCredits 的 taskId 去重（registration-welcome:${userId}）。
 */
export async function grantRegistrationWelcomeCredits(
	c: AppContext,
	userId: string,
	refCode: string | null,
): Promise<void> {
	const trimmed = typeof refCode === "string" ? refCode.trim().toUpperCase() : "";
	if (INVITE_CODE_FORMAT.test(trimmed)) return;
	try {
		const config = await repo.getReferralConfig(c.env.DB);
		const amount = Number(config?.registration_welcome_credits ?? 100) || 0;
		if (amount <= 0) return;
		const nowIso = new Date().toISOString();
		const taskId = `registration-welcome:${userId}`;
		const credit = await topUpTeamCredits(c.env.DB, {
			teamId: `personal_${userId}`,
			amount,
			actorUserId: userId,
			note: JSON.stringify({ kind: "registration_welcome" }),
			nowIso,
			entryType: "registration_welcome",
			taskId,
			taskKind: "registration_welcome",
			sourceType: "registration_welcome",
			sourceKey: taskId,
		});
		if (!credit.ledgerEntryId) {
			throw new Error(`registration welcome credit ledger missing: ${taskId}`);
		}
	} catch (err) {
		console.error("[referral] grantRegistrationWelcomeCredits failed", err);
	}
}
```

注：与 `bindReferrerOnRegister` 一致，发放失败仅记日志不阻断登录（积分是赠品，不能挡注册主流程；ledger 缺失属于数据异常，错误日志保留现场）。

`auth.service.ts` persistLoginUser created 分支（L128 `await bindReferrerOnRegister(...)` 之后）追加：

```ts
			const { grantRegistrationWelcomeCredits } = await import(
				"../referral/referral.service"
			);
			await grantRegistrationWelcomeCredits(c, input.id, refCode);
```

- [ ] **Step 4: 运行测试通过**

Run: `pnpm --filter ./apps/hono-api test -- src/modules/referral/registration-welcome.test.ts`
Expected: PASS（4 个 case）

- [ ] **Step 5: Commit**（需用户确认）

```
feat(referral): grant configurable welcome credits on plain registration
```

---

### Task 3: OTP 限流器（Redis）

**Files:**
- Create: `apps/hono-api/src/modules/auth/otp-rate-limit.ts`
- Test: `apps/hono-api/src/modules/auth/otp-rate-limit.test.ts`
- Modify: `apps/hono-api/src/modules/auth/auth.service.ts`（requestEmailLoginCode / verifyEmailLoginCode 接线，见 Task 4 一并完成调用点）

**Interfaces:**
- Consumes: `getSharedRedis(): IORedis | null`（platform/redis-shared）
- Produces:
  - `checkOtpSendLimit(opts: { redis: IORedis; emailHash: string; clientIp: string | null }): Promise<void>`（超限 throw `OtpRateLimitError(message, retryAfterSeconds)`；Redis 不可用 throw `OtpRateLimitUnavailableError`）
  - `recordOtpVerifyResult(opts: { redis: IORedis; emailHash: string; ok: boolean }): Promise<void>`（ok=true 清零；ok=false 计数，>=5 throw `OtpVerifyLockedError(900)`）
  - 错误类均 `extends Error` 且带 `status: 429` 供路由层 `instanceof` 转 c.json

- [ ] **Step 1: 写失败测试**

```ts
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
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter ./apps/hono-api test -- src/modules/auth/otp-rate-limit.test.ts`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 `otp-rate-limit.ts`**

```ts
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
		if (next > VERIFY_FAIL_MAX) throw new OtpVerifyLockedError(VERIFY_LOCK_SECONDS);
	} catch (err) {
		if (err instanceof OtpRateLimitError) throw err;
		throw new OtpRateLimitUnavailableError();
	}
}
```

- [ ] **Step 4: 测试通过**

Run: `pnpm --filter ./apps/hono-api test -- src/modules/auth/otp-rate-limit.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**（需用户确认）

```
feat(auth): add Redis-backed OTP send/verify rate limits
```

---

### Task 4: 恢复邮箱验证码路由 + 接线限流

**Files:**
- Modify: `apps/hono-api/src/modules/auth/auth.routes.ts`（L187-207 两个 410 桩替换）
- Modify: `apps/hono-api/src/modules/auth/auth.service.ts`（requestEmailLoginCode / verifyEmailLoginCode 内接入 Task 3 限流）

**Interfaces:**
- Consumes: Task 3 的 `checkOtpSendLimit` / `recordOtpVerifyResult` 及错误类
- Produces: `POST /auth/email/request`、`POST /auth/email/verify` 恢复可用（与前端 `requestEmailLoginCode` / `verifyEmailLogin` 现有绑定对齐：成功 request 返回 `{success:true, sent:true, expiresInSeconds}`；verify 返回 AuthResponse 并落 cookie，走现有 `attachValidatedAuthCookies`）

- [ ] **Step 1: service 层接限流**

`requestEmailLoginCode` 中，`if (!isAliyunEmailConfigured(config))` 块之后、`const id = crypto.randomUUID()` 之前插入：

```ts
	const emailHash = await sha256Hex(email);
	const clientIp =
		c.req.header("cf-connecting-ip") ?? c.req.header("x-forwarded-for") ?? null;
	const redis = getSharedRedis();
	if (!redis) {
		return c.json(
			{ success: false, error: "限流服务暂不可用，请稍后再试", code: "rate_limit_unavailable" },
			503,
		);
	}
	try {
		await checkOtpSendLimit({ redis, emailHash, clientIp });
	} catch (err) {
		if (err instanceof OtpRateLimitError) {
			return c.json({ success: false, error: err.message }, 429);
		}
		throw err;
	}
```

`verifyEmailLoginCode` 中，`const row = await ...findFirst` 查询之前插入同样取 redis 的守卫；`if (!row)` 与哈希不匹配两个 return 401 之前调用：

```ts
	try {
		await recordOtpVerifyResult({ redis, emailHash, ok: false });
	} catch (err) {
		if (err instanceof OtpRateLimitError) {
			return c.json({ success: false, error: err.message }, 429);
		}
		throw err;
	}
```

校验成功、`used_at` 更新之后插入：

```ts
	try {
		await recordOtpVerifyResult({ redis, emailHash, ok: true });
	} catch {
		// 成功路径清理失败计数失败不影响登录
	}
```

文件顶部 import：`import { getSharedRedis } from "../../platform/redis-shared";` 与 `import { checkOtpSendLimit, recordOtpVerifyResult, OtpRateLimitError } from "./otp-rate-limit";`

- [ ] **Step 2: 路由层恢复**

`auth.routes.ts` 两个 410 桩替换为：

```ts
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

authRouter.post("/email/request", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
	if (!EMAIL_FORMAT.test(email)) {
		return c.json({ success: false, error: "邮箱格式不正确" }, 400);
	}
	const result = await requestEmailLoginCode(c, email);
	if (result instanceof Response) return result;
	return c.json({ success: true, sent: true, expiresInSeconds: result.expiresInSeconds });
});

authRouter.post("/email/verify", async (c) => {
	const body = (await c.req.json().catch(() => ({}))) ?? {};
	const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
	const code = typeof body.code === "string" ? body.code.trim() : "";
	if (!EMAIL_FORMAT.test(email) || !/^\d{6}$/.test(code)) {
		return c.json({ success: false, error: "邮箱或验证码格式不正确" }, 400);
	}
	const result = await verifyEmailLoginCode(c, email, code);
	if (result instanceof Response) return result;
	const validated = AuthResponseSchema.parse(result);
	attachValidatedAuthCookies(c, validated);
	return c.json(browserAuthResponse(validated));
});
```

`auth.routes.ts` 顶部 import 补：`requestEmailLoginCode`、`verifyEmailLoginCode`（来自 `./auth.service`，与现有 import 合并）。

- [ ] **Step 3: 回归**

Run: `pnpm --filter ./apps/hono-api test`
Expected: 全部 PASS（含 auth.service.test.ts 既有用例不回归）

- [ ] **Step 4: Commit**（需用户确认）

```
feat(auth): restore email verification-code login with rate limits
```

---

### Task 5: 可选密码端点

**Files:**
- Modify: `apps/hono-api/src/modules/account/account.service.ts`（新增两个函数）
- Modify: `apps/hono-api/src/modules/account/account.routes.ts`（新增两条路由）
- Test: `apps/hono-api/src/modules/account/account.password.test.ts`

**Interfaces:**
- Consumes: `createPasswordRecord(password)` / `verifyPasswordRecord({password,hash,salt})`（auth/password.ts）
- Produces:
  - `POST /account/password` body `{password}`：首次设置（当前用户无密码时），成功返回 `{success:true}`
  - `PUT /account/password` body `{currentPassword, password}`：修改（当前用户已有密码时），成功返回 `{success:true}`
  - 校验：密码 ≥8 位；无密码时调 set 端点外的路径分别拒绝（409 `password_already_set` / 409 `password_not_set`）

- [ ] **Step 1: 写失败测试**

```ts
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
	return { get: (key: string) => (key === "userId" ? userId : undefined), env: { DB: {} } } as unknown as Parameters<typeof setAccountPassword>[0];
}

describe("account password", () => {
	beforeEach(() => {
		findUniqueMock.mockReset();
		updateMock.mockReset().mockResolvedValue({});
	});

	it("set: rejects short password", async () => {
		await expect(setAccountPassword(fakeContext("u1"), "u1", "short")).rejects.toThrow(/至少 8 位/);
	});

	it("set: rejects when password already configured", async () => {
		findUniqueMock.mockResolvedValue({ id: "u1", password_hash: "h", password_salt: "s" });
		await expect(setAccountPassword(fakeContext("u1"), "u1", "longenough1")).rejects.toThrow(/已设置/);
	});

	it("set: writes hash/salt/updated_at when no password", async () => {
		findUniqueMock.mockResolvedValue({ id: "u1", password_hash: null, password_salt: null });
		await setAccountPassword(fakeContext("u1"), "u1", "longenough1");
		expect(updateMock).toHaveBeenCalledWith(expect.objectContaining({
			where: { id: "u1" },
			data: expect.objectContaining({ password_updated_at: expect.any(String) }),
		}));
	});

	it("change: rejects wrong current password", async () => {
		findUniqueMock.mockResolvedValue({ id: "u1", password_hash: "h", password_salt: "s" });
		await expect(changeAccountPassword(fakeContext("u1"), "u1", "wrongpass1", "longenough1")).rejects.toThrow(/当前密码不正确/);
	});
});
```

（`verifyPasswordRecord` 为真实 PBKDF2 实现，"wrongpass1" 对 hash "h"/salt "s" 必然不匹配，无需 mock。）

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter ./apps/hono-api test -- src/modules/account/account.password.test.ts`
Expected: FAIL（函数未导出）

- [ ] **Step 3: 实现 service（account.service.ts 追加）**

```ts
const MIN_PASSWORD_LENGTH = 8;

function assertPasswordStrength(password: string): void {
	if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
		throw new AppError(`密码至少 ${MIN_PASSWORD_LENGTH} 位`, { status: 400, code: "password_too_short" });
	}
}

export async function setAccountPassword(c: AppContext, userId: string, password: string): Promise<void> {
	assertPasswordStrength(password);
	const user = await getPrismaClient().users.findUnique({
		where: { id: userId },
		select: { id: true, password_hash: true, password_salt: true },
	});
	if (!user) throw new AppError("用户不存在", { status: 404, code: "user_not_found" });
	if (hasPasswordConfigured(user.password_hash)) {
		throw new AppError("密码已设置，请使用修改密码", { status: 409, code: "password_already_set" });
	}
	const record = await createPasswordRecord(password);
	const nowIso = new Date().toISOString();
	await getPrismaClient().users.update({
		where: { id: userId },
		data: {
			password_hash: record.hash,
			password_salt: record.salt,
			password_updated_at: nowIso,
			updated_at: nowIso,
		},
	});
}

export async function changeAccountPassword(
	c: AppContext,
	userId: string,
	currentPassword: string,
	password: string,
): Promise<void> {
	assertPasswordStrength(password);
	const user = await getPrismaClient().users.findUnique({
		where: { id: userId },
		select: { id: true, password_hash: true, password_salt: true },
	});
	if (!user) throw new AppError("用户不存在", { status: 404, code: "user_not_found" });
	if (!hasPasswordConfigured(user.password_hash) || !user.password_salt) {
		throw new AppError("尚未设置密码，请先设置密码", { status: 409, code: "password_not_set" });
	}
	const ok = await verifyPasswordRecord({
		password: currentPassword,
		hash: user.password_hash,
		salt: user.password_salt,
	});
	if (!ok) throw new AppError("当前密码不正确", { status: 401, code: "password_mismatch" });
	const record = await createPasswordRecord(password);
	const nowIso = new Date().toISOString();
	await getPrismaClient().users.update({
		where: { id: userId },
		data: {
			password_hash: record.hash,
			password_salt: record.salt,
			password_updated_at: nowIso,
			updated_at: nowIso,
		},
	});
}
```

（import 补：`AppError`、`getPrismaClient`、`createPasswordRecord`、`verifyPasswordRecord`、`hasPasswordConfigured`——按文件现有 import 风格合并；若 account.service 已 import 其中部分则不重复。）

- [ ] **Step 4: 实现路由（account.routes.ts，放在现有 profile 路由附近）**

```ts
const PasswordSetSchema = z.object({ password: z.string() });
const PasswordChangeSchema = z.object({ currentPassword: z.string(), password: z.string() });

accountRouter.post("/password", async (c) => {
	const userId = requireUserId(c);
	const parsed = PasswordSetSchema.safeParse(await c.req.json().catch(() => ({})));
	if (!parsed.success) return c.json({ success: false, error: "请求参数不合法" }, 400);
	try {
		await setAccountPassword(c, userId, parsed.data.password);
	} catch (error) {
		if (error instanceof AppError) return c.json({ success: false, error: error.message, code: error.code }, error.status);
		throw error;
	}
	return c.json({ success: true });
});

accountRouter.put("/password", async (c) => {
	const userId = requireUserId(c);
	const parsed = PasswordChangeSchema.safeParse(await c.req.json().catch(() => ({})));
	if (!parsed.success) return c.json({ success: false, error: "请求参数不合法" }, 400);
	try {
		await changeAccountPassword(c, userId, parsed.data.currentPassword, parsed.data.password);
	} catch (error) {
		if (error instanceof AppError) return c.json({ success: false, error: error.message, code: error.code }, error.status);
		throw error;
	}
	return c.json({ success: true });
});
```

（import 补 `z` from "zod"、`AppError`、两个 service 函数；确认 `/account` 挂载路径后，前端调用为 `POST/PUT {API_BASE}/account/password`。）

- [ ] **Step 5: 测试通过 + 全量回归**

Run: `pnpm --filter ./apps/hono-api test`
Expected: PASS

- [ ] **Step 6: Commit**（需用户确认）

```
feat(account): add optional password set/change endpoints
```

---

### Task 6: 前端登录面板多 Tab 化

**Files:**
- Create: `apps/web/src/auth/EmailCodeLoginForm.tsx`
- Create: `apps/web/src/auth/WechatQrLoginForm.tsx`
- Create: `apps/web/src/auth/PasswordLoginForm.tsx`
- Modify: `apps/web/src/auth/LoginForm.tsx`（重构为 Tab 容器）
- Modify: `apps/web/src/auth/loginOverlay.css`（Tab 样式）
- Modify: `apps/web/src/auth/defaultCredentials.ts`（不改文件，改 LoginForm 内该块的渲染门控）

**Interfaces:**
- Consumes: `requestEmailLoginCode(email)`、`verifyEmailLogin(email, code)`、`createWechatLoginSession/GetWechatLoginStatus/consumeWechatLoginSession`、`WechatLoginDisabledError`、`loginWithCredentials`（server.ts）
- Consumes: `VITE_GITHUB_CLIENT_ID`（env，空=隐藏 GitHub 按钮）；GitHub 按钮跳转 `{API_BASE}/auth/github?redirect=...`（与现有 GithubGate 回调约定一致，实施时以 `GithubGate.tsx` 中现有发起方式为准，若为前端构造 authorize URL 则复用同一 helper）
- Produces: `<LoginForm onLoginSuccess={...} />` 对外 props 不变（LoginOverlay 无需改动）

- [ ] **Step 1: EmailCodeLoginForm.tsx**

```tsx
import React from 'react'
import { Button, Code, Group, Stack, Text, TextInput } from '@mantine/core'
import { requestEmailLoginCode, verifyEmailLogin } from '../api/server'
import { toast } from '../ui/toast'
import type { User } from './store'

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export interface EmailCodeLoginFormProps {
  onLoginSuccess: (user: User) => void
}

export function EmailCodeLoginForm({ onLoginSuccess }: EmailCodeLoginFormProps): JSX.Element {
  const [email, setEmail] = React.useState('')
  const [code, setCode] = React.useState('')
  const [sending, setSending] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [countdown, setCountdown] = React.useState(0)

  React.useEffect(() => {
    if (countdown <= 0) return
    const timer = window.setInterval(() => setCountdown((v) => Math.max(0, v - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [countdown])

  const handleSend = React.useCallback(async () => {
    const normalizedEmail = email.trim()
    if (!EMAIL_FORMAT.test(normalizedEmail)) { toast('请输入正确的邮箱地址', 'error'); return }
    if (sending || countdown > 0) return
    setSending(true)
    try {
      const result = await requestEmailLoginCode(normalizedEmail)
      setCountdown(60)
      toast(result.expiresInSeconds ? `验证码已发送，${Math.round(result.expiresInSeconds / 60)} 分钟内有效` : '验证码已发送', 'success')
    } catch (error) {
      console.error('Send email code failed', error)
      toast(getErrorMessage(error, '验证码发送失败，请稍后再试'), 'error')
    } finally {
      setSending(false)
    }
  }, [countdown, email, sending])

  const handleSubmit = React.useCallback(async () => {
    const normalizedEmail = email.trim()
    if (!EMAIL_FORMAT.test(normalizedEmail)) { toast('请输入正确的邮箱地址', 'error'); return }
    if (!/^\d{6}$/.test(code.trim())) { toast('请输入 6 位验证码', 'error'); return }
    if (submitting) return
    setSubmitting(true)
    try {
      const { user } = await verifyEmailLogin(normalizedEmail, code.trim())
      onLoginSuccess(user)
    } catch (error) {
      console.error('Email code login failed', error)
      toast(getErrorMessage(error, '验证码登录失败，请稍后再试'), 'error')
    } finally {
      setSubmitting(false)
    }
  }, [code, email, onLoginSuccess, submitting])

  return (
    <Stack className="tc-email-login" gap="sm">
      <TextInput
        className="tc-email-login__email"
        label="邮箱"
        placeholder="you@example.com"
        value={email}
        onChange={(event) => setEmail(event.currentTarget.value)}
        autoComplete="email"
      />
      <Group className="tc-email-login__code-row" gap="sm" align="flex-end" wrap="nowrap">
        <TextInput
          className="tc-email-login__code"
          label="验证码"
          placeholder="6 位数字"
          value={code}
          onChange={(event) => setCode(event.currentTarget.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void handleSubmit() }}
          autoComplete="one-time-code"
          style={{ flex: 1 }}
        />
        <Button
          className="tc-email-login__send"
          variant="light"
          disabled={sending || countdown > 0 || !EMAIL_FORMAT.test(email.trim())}
          loading={sending}
          onClick={() => void handleSend()}
        >
          {countdown > 0 ? `${countdown}s 后重发` : '发送验证码'}
        </Button>
      </Group>
      <Button
        className="tc-email-login__submit"
        fullWidth
        loading={submitting}
        disabled={!EMAIL_FORMAT.test(email.trim()) || !/^\d{6}$/.test(code.trim())}
        onClick={() => void handleSubmit()}
      >
        登录 / 注册
      </Button>
      <Text className="tc-email-login__hint" size="xs" c="dimmed">
        未注册的邮箱将自动创建账号
      </Text>
    </Stack>
  )
}
```

注：`Code` 未用到则从 import 移除（以 lint 为准）。

- [ ] **Step 2: WechatQrLoginForm.tsx**

```tsx
import React from 'react'
import { Image, Loader, Stack, Text } from '@mantine/core'
import {
  consumeWechatLoginSession,
  createWechatLoginSession,
  getWechatLoginStatus,
  WechatLoginDisabledError,
} from '../api/server'
import { toast } from '../ui/toast'
import type { User } from './store'

const POLL_INTERVAL_MS = 1500

export interface WechatQrLoginFormProps {
  active: boolean
  onLoginSuccess: (user: User) => void
}

export function WechatQrLoginForm({ active, onLoginSuccess }: WechatQrLoginFormProps): JSX.Element {
  const [qr, setQr] = React.useState<{ sessionId: string; qrCodeUrl: string } | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [statusText, setStatusText] = React.useState('正在生成二维码…')

  React.useEffect(() => {
    if (!active) return
    let alive = true
    let timer: number | null = null
    void (async () => {
      try {
        const session = await createWechatLoginSession()
        if (!alive) return
        setQr({ sessionId: session.sessionId, qrCodeUrl: session.qrCodeUrl })
        setStatusText('请用微信扫码')
        timer = window.setInterval(() => {
          void (async () => {
            try {
              const status = await getWechatLoginStatus(session.sessionId)
              if (!alive) return
              if (status.status === 'authorized') {
                if (timer !== null) window.clearInterval(timer)
                setStatusText('已确认，正在登录…')
                const { user } = await consumeWechatLoginSession(session.sessionId)
                if (!alive) return
                onLoginSuccess(user)
              } else if (status.status === 'expired') {
                if (timer !== null) window.clearInterval(timer)
                setStatusText('二维码已过期，请切换 Tab 重新进入')
              } else if (status.status === 'unlinked') {
                setStatusText('该微信尚未绑定账号，请先用邮箱验证码登录')
              }
            } catch (pollError) {
              console.error('Wechat login poll failed', pollError)
            }
          })()
        }, POLL_INTERVAL_MS)
      } catch (createError) {
        if (createError instanceof WechatLoginDisabledError) {
          setError('微信扫码登录未开启')
        } else {
          console.error('Create wechat session failed', createError)
          setError('二维码生成失败，请稍后再试')
        }
      }
    })()
    return () => {
      alive = false
      if (timer !== null) window.clearInterval(timer)
    }
  }, [active, onLoginSuccess])

  return (
    <Stack className="tc-wechat-login" align="center" gap="sm">
      {qr ? (
        <Image className="tc-wechat-login__qr" src={qr.qrCodeUrl} alt="微信扫码登录二维码" w={200} h={200} fit="contain" />
      ) : (
        <Stack className="tc-wechat-login__placeholder" align="center" gap="xs" h={200} justify="center">
          {error ? <Text className="tc-wechat-login__error" size="sm" c="red">{error}</Text> : <Loader size="sm" />}
        </Stack>
      )}
      <Text className="tc-wechat-login__status" size="sm" c="dimmed">{statusText}</Text>
    </Stack>
  )
}
```

注：`WechatLoginDisabledError` 若 Tab 容器已在会话创建前探测（见 Step 4 的 Tab 预检），此组件的错误分支作为兜底显示；不静默重试。

- [ ] **Step 3: PasswordLoginForm.tsx**

把现 `LoginForm.tsx` 的账号密码部分（L21-104 的 state + 表单 JSX）迁入为新组件，改动两点：
1. 文案从「管理员账号/密码」改为「账号 / 密码」（管理员与普通用户共用）
2. `defaultCredentials` 块用 `import.meta.env.DEV` 门控：

```tsx
      {import.meta.env.DEV ? (
        <div className="tc-login-form__default-credentials">
          {/* ...现 L56-73 内容原样保留... */}
        </div>
      ) : null}
```

- [ ] **Step 4: LoginForm.tsx 重构为 Tab 容器**

```tsx
import React from 'react'
import { Anchor, Group, Stack, Tabs, Text } from '@mantine/core'
import { IconBrandGithub } from '@tabler/icons-react'
import { apiFetch, API_BASE } from '../api/server'
import { EmailCodeLoginForm } from './EmailCodeLoginForm'
import { WechatQrLoginForm } from './WechatQrLoginForm'
import { PasswordLoginForm } from './PasswordLoginForm'
import type { User } from './store'

const GUIDE_URL = 'https://ai.feishu.cn/wiki/YZWhw4w2FiO02LkqYosc4NY5nSh'
const GITHUB_CLIENT_ID = (import.meta.env.VITE_GITHUB_CLIENT_ID as string | undefined)?.trim() ?? ''

export interface LoginFormProps {
  onLoginSuccess: (user: User) => void
  showTitle?: boolean
}

export function LoginForm({ onLoginSuccess, showTitle = true }: LoginFormProps): JSX.Element {
  const [wechatAvailable, setWechatAvailable] = React.useState<boolean | null>(null)

  // 进入登录面板时探测微信扫码是否可用（501=未配置），决定 Tab 是否展示
  React.useEffect(() => {
    let alive = true
    void apiFetch(`${API_BASE}/auth/wechat-official/sessions/preflight`, { method: 'POST' })
      .then((r) => { if (alive) setWechatAvailable(r.status !== 501) })
      .catch(() => { if (alive) setWechatAvailable(false) })
    return () => { alive = false }
  }, [])

  const handleGithubLogin = React.useCallback(() => {
    const redirect = window.location.pathname + window.location.search
    window.location.href = `${API_BASE}/auth/github?redirect=${encodeURIComponent(redirect)}`
  }, [])

  return (
    <Stack className="tc-login-form" gap="md">
      {showTitle ? (
        <Stack className="tc-login-form__heading" gap={2}>
          <Text className="tc-login-form__title" fw={600} size="md" ta="center">登录 TapCanvas</Text>
          <Group className="tc-login-form__guide" justify="center" gap={6}>
            <Text className="tc-login-form__guide-label" size="xs" c="dimmed">不知道怎么用？</Text>
            <Anchor className="tc-login-form__guide-link" size="xs" href={GUIDE_URL} target="_blank" rel="noreferrer">查看使用指引</Anchor>
          </Group>
        </Stack>
      ) : null}

      <Tabs className="tc-login-form__tabs" defaultValue="email" keepMounted={false}>
        <Tabs.List className="tc-login-form__tab-list" justify="center">
          <Tabs.Tab className="tc-login-form__tab" value="email">验证码登录</Tabs.Tab>
          {wechatAvailable ? (
            <Tabs.Tab className="tc-login-form__tab" value="wechat">微信扫码</Tabs.Tab>
          ) : null}
        </Tabs.List>

        <Tabs.Panel className="tc-login-form__tab-panel" value="email" pt="sm">
          <EmailCodeLoginForm onLoginSuccess={onLoginSuccess} />
        </Tabs.Panel>
        {wechatAvailable ? (
          <Tabs.Panel className="tc-login-form__tab-panel" value="wechat" pt="sm">
            <WechatQrLoginForm active onLoginSuccess={onLoginSuccess} />
          </Tabs.Panel>
        ) : null}
      </Tabs>

      {GITHUB_CLIENT_ID ? (
        <Anchor
          className="tc-login-form__github"
          onClick={(event) => { event.preventDefault(); handleGithubLogin() }}
          aria-label="使用 GitHub 登录"
          style={{ display: 'flex', justifyContent: 'center' }}
        >
          <IconBrandGithub size={22} />
        </Anchor>
      ) : null}

      <PasswordLoginForm onLoginSuccess={onLoginSuccess} />
    </Stack>
  )
}
```

说明：
- Tab 探测：we statuses 路由若无 `/preflight` 端点，则改为首次渲染 wechat Tab 面板时由 `WechatQrLoginForm` 的 `WechatLoginDisabledError` 兜底（实施时二选一，优先加一个无副作用的 `GET /auth/wechat-official/config` 探测端点——`auth.routes.ts` 返回 `{available: boolean}`，501 改 200+available:false 不符合语义，用 200/`{available}` 即可）。**决定：新增 `GET /auth/wechat-official/config` 返回 `{ available: boolean }`**，前端 preflight 调用改为该端点；`WechatQrLoginForm` 保留错误兜底。
- `PasswordLoginForm` 默认收起（`<details className="tc-login-form__password-collapse"><summary>账号密码登录</summary>…</details>` 包一层），管理员与设密码用户点开使用；样式在 loginOverlay.css 补极简 summary 样式（无边框，`cursor:pointer`，`c=dimmed` 尺寸 xs）。
- `apiFetch`/`API_BASE` 若未从 server.ts 导出 `API_BASE`，使用现有导出名（实施时以 server.ts 实际导出为准，不新增导出）。

- [ ] **Step 5: wechat config 探测端点（后端）**

`auth.routes.ts` 加：

```ts
authRouter.get("/wechat-official/config", async (c) => {
	const config = getConfig(c.env);
	const available = Boolean(
		config.wechatOfficialAppId && config.wechatOfficialAppSecret,
	);
	return c.json({ available });
});
```

（config 字段名以 `apps/hono-api/src/config.ts` 实际定义为准——实施时 grep `wechatOfficial` 确认，无则改用 `readEnv` 同款判断，与 `auth/wechat-official` service 的配置读取保持同源，禁止两套判断。）

- [ ] **Step 6: 构建验证**

Run: `pnpm --filter @tapcanvas/web build`
Expected: 构建通过，无 TS 错误

- [ ] **Step 7: Commit**（需用户确认）

```
feat(web): multi-tab login panel with email code, wechat QR and optional password
```

---

### Task 7: 账号中心补设密码入口（小）

**Files:**
- Modify: `apps/web/src/portal/account/`（找到账号安全/资料设置视图；若无安全分区，在账号设置页加「设置密码」区块：无密码时显示 `POST /account/password` 表单，有密码时显示修改表单）
- Modify: `apps/web/src/api/server.ts`（新增 `setAccountPassword(password)` / `changeAccountPassword(currentPassword, password)` 绑定，模式同 L5003 `loginWithCredentials`，成功判定 `body.success === true`，失败抛 `Error(body.error)`）

**Interfaces:**
- Consumes: Task 5 的两条端点
- Produces: 账号中心 UI 入口（是否已有密码可通过现有 `/account/profile` 返回值判断；若 profile DTO 无 `hasPassword` 字段，则后端 `getProfile` 补 `hasPassword: hasPasswordConfigured(password_hash)`）

- [ ] **Step 1: server.ts API 绑定**

```ts
export async function setAccountPassword(password: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/account/password`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!r.ok) {
    const body = await r.json().catch(() => null)
    throw new Error((body && (body.error || body.message)) || `set password failed: ${r.status}`)
  }
}

export async function changeAccountPassword(currentPassword: string, password: string): Promise<void> {
  const r = await apiFetch(`${API_BASE}/account/password`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ currentPassword, password }),
  })
  if (!r.ok) {
    const body = await r.json().catch(() => null)
    throw new Error((body && (body.error || body.message)) || `change password failed: ${r.status}`)
  }
}
```

- [ ] **Step 2: 后端 getProfile 补 hasPassword**（若 DTO 缺失）

`account.service.ts` `getProfile` 返回对象加 `hasPassword: hasPasswordConfigured(<user>.password_hash)`（select 需带上 `password_hash`）；前端 profile DTO 类型同步。

- [ ] **Step 3: 账号设置 UI**

在账号设置页（`AccountRewardsView.tsx` 同级找 settings/profile 视图）加「密码」区块：
- `hasPassword === false`：两个 PasswordInput（密码/确认密码）+「设置密码」按钮 → `setAccountPassword`
- `hasPassword === true`：三个 PasswordInput（当前密码/新密码/确认密码）+「修改密码」→ `changeAccountPassword`
- 成功 `toast('密码已保存', 'success')`；失败 toast 后端错误原文
- 每个 input 带 `className="tc-account-password__*"`（仓库 JSX 规范：所有标签必须有具名 className）

- [ ] **Step 4: 构建验证 + Commit**（需用户确认）

Run: `pnpm --filter @tapcanvas/web build`
Expected: 通过

```
feat(web): password management in account settings
```

---

### Task 8: 全量验证（本机）

- [ ] **Step 1: 后端全量测试**

Run: `pnpm --filter ./apps/hono-api test`
Expected: 全 PASS

- [ ] **Step 2: web 构建**

Run: `pnpm --filter @tapcanvas/web build`
Expected: 通过

- [ ] **Step 3: 手动冒烟（本地 dev）**

`pnpm --filter ./apps/hono-api dev` + `pnpm dev:web`，localhost 下 email OTP 走 dev 直返 code 分支：
1. 验证码 Tab：输邮箱 → 发送 → 60s 倒计时 → 用 dev code 登录 → 新用户建档、personal team 有 `registration_welcome` 积分入账
2. 60s 内再次发送 → 429 文案显示
3. 微信 Tab 未配置时不显示；GitHub 按钮未配置时不显示
4. 「账号密码登录」点开：admin 登录成功；生产构建（`pnpm build`）后 defaultCredentials 块不渲染
5. 账号中心：设置密码 → 用该密码走「账号密码登录」成功

---

## 部署阶段（代码完成后，需用户提供配置）

1. 阿里云邮件推送 AccessKey/发信地址 → 服务器 env `ALIYUN_EMAIL_ACCESS_KEY_ID/SECRET/FROM`；发信域名完成 SPF/DKIM
2. 微信公众号 AppID/Secret → `WECHAT_OFFICIAL_*`；GitHub OAuth App（callback `https://huabu.wavee.cn/oauth/github`）→ 后端 `GITHUB_CLIENT_ID/SECRET` + 前端 `.env.production` `VITE_GITHUB_CLIENT_ID`
3. 服务器执行 schema 更新（referral_config 新列）：`pnpm --filter ./apps/hono-api db:pg:schema`
4. hono-api 本地构建 → 上传 → 重启；前端构建（剔除 ffmpeg-core.wasm）→ `edgeone pages deploy`
5. 线上冒烟：真实验证码登录、积分入账、微信/GitHub 入口按配置显隐
