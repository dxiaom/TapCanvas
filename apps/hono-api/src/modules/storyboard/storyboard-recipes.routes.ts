import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../types";
import { loadStoryboardRecipes } from "./storyboard-recipes.service";

export function registerStoryboardRecipeRoutes(router: OpenAPIHono<AppEnv>) {
  router.get("/storyboard/recipes", async (c) => {
    // 零隐式兜底：recipes.json 缺失/损坏属于部署不完整，必须显式失败暴露根因，
    // 静默返回 [] 会让"分镜配方"能力以空列表的形式不可见地消失。
    try {
      const recipes = await loadStoryboardRecipes();
      return c.json(recipes, 200);
    } catch (err) {
      console.error("[storyboard-recipes] failed to load recipes.json:", err);
      return c.json(
        {
          error: "分镜配方数据加载失败（recipes.json 缺失或损坏）",
          code: "storyboard_recipes_unavailable",
          details: err instanceof Error ? err.message : String(err),
        },
        500,
      );
    }
  });
}
