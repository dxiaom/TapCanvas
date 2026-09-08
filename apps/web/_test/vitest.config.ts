import { defineConfig } from "vitest/config";

// 默认 node 环境；需要 DOM 的测试文件用 `// @vitest-environment jsdom` 头注释显式声明。
export default defineConfig({
	test: {
		environment: "node",
		globals: false,
		setupFiles: ["./_test/vitest.setup.ts"],
	},
});
