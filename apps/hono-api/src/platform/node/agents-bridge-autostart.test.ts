import { afterEach, describe, expect, it } from "vitest";
import {
	isDeepSeekHarnessHealthPayload,
	maybeAutostartAgentsBridge,
	parseLocalAgentsBridgeEndpoint,
} from "./agents-bridge-autostart";

describe("agents bridge autostart endpoint", () => {
	it("preserves the exact configured loopback port for local recovery", () => {
		expect(parseLocalAgentsBridgeEndpoint("http://127.0.0.1:8800/")).toEqual({
			host: "127.0.0.1",
			port: 8800,
			baseUrl: "http://127.0.0.1:8800",
		});
		expect(parseLocalAgentsBridgeEndpoint("http://localhost:8799")).toEqual({
			host: "localhost",
			port: 8799,
			baseUrl: "http://localhost:8799",
		});
	});

	it("does not claim ownership of remote, credentialed, or path-scoped bridges", () => {
		expect(parseLocalAgentsBridgeEndpoint("https://agents.example.com")).toBeNull();
		expect(parseLocalAgentsBridgeEndpoint("http://agents.example.com:8800")).toBeNull();
		expect(parseLocalAgentsBridgeEndpoint("http://user:secret@127.0.0.1:8800")).toBeNull();
		expect(parseLocalAgentsBridgeEndpoint("http://127.0.0.1:8800/api")).toBeNull();
	});
});

describe("agents bridge runtime identity", () => {
	it("accepts only the pinned DeepSeek Harness SDK health contract", () => {
		expect(isDeepSeekHarnessHealthPayload({
			ok: true,
			runtime: "deepseek-harness",
			profile: "sdk",
			upstreamVersion: "0.1.2-alpha.2",
		})).toBe(true);
		expect(isDeepSeekHarnessHealthPayload({ ok: true })).toBe(false);
		expect(isDeepSeekHarnessHealthPayload({
			ok: true,
			runtime: "agents-cli",
			profile: "code",
			upstreamVersion: "0.1.2-alpha.2",
		})).toBe(false);
		expect(isDeepSeekHarnessHealthPayload({
			ok: true,
			runtime: "deepseek-harness",
			profile: "sdk",
			upstreamVersion: "0.1.1",
		})).toBe(false);
	});
});

describe("maybeAutostartAgentsBridge（部署运维模式）", () => {
	const savedEnv: Record<string, string | undefined> = {};

	function saveEnv(keys: string[]): void {
		for (const key of keys) savedEnv[key] = process.env[key];
	}

	function restoreEnv(keys: string[]): void {
		for (const key of keys) {
			const value = savedEnv[key];
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}

	const MANAGED_KEYS = [
		"AGENTS_BRIDGE_AUTOSTART",
		"AGENTS_BRIDGE_SERVE_ENTRY",
		"AGENTS_BRIDGE_BASE_URL",
		"AGENTS_BRIDGE_HOST",
		"AGENTS_BRIDGE_PORT",
		"AGENTS_BRIDGE_TOKEN",
	];

	afterEach(() => restoreEnv(MANAGED_KEYS));

	it("SERVE_ENTRY 指向不存在的入口时跳过 autostart，绝不拖垮 API 启动", async () => {
		saveEnv(MANAGED_KEYS);
		process.env.NODE_ENV = "production";
		process.env.AGENTS_BRIDGE_AUTOSTART = "1";
		process.env.AGENTS_BRIDGE_SERVE_ENTRY = "/definitely/missing/agents-cli-entry.js";
		delete process.env.AGENTS_BRIDGE_BASE_URL;
		delete process.env.AGENTS_BRIDGE_HOST;
		delete process.env.AGENTS_BRIDGE_PORT;
		delete process.env.AGENTS_BRIDGE_TOKEN;

		// 不抛错 = API 启动不会被 bridge autostart 失败拖垮（部署运维模式合同）
		await expect(maybeAutostartAgentsBridge()).resolves.toBeUndefined();
	});
});
