import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../types";
import { listProfiles } from "./profile-library.service";

// 领域档案（domain profile）列表，供前端确认卡的下拉与默认展示。
// 挂在 publicApiRouter（/public 前缀）。零隐式兜底：profiles.json 缺失/损坏时
// 显式 500 暴露根因，不再静默返回 []（前端确认卡自带兜底档展示）。
export function registerStoryboardProfileRoutes(router: OpenAPIHono<AppEnv>) {
  router.get("/storyboard/profiles", async (c) => {
    try {
      const profiles = await listProfiles();
      return c.json(profiles, 200);
    } catch (err) {
      console.error("[storyboard-profiles] failed to load profiles.json:", err);
      return c.json(
        {
          error: "领域档案数据加载失败（profiles.json 缺失或损坏）",
          code: "storyboard_profiles_unavailable",
          details: err instanceof Error ? err.message : String(err),
        },
        500,
      );
    }
  });
}
