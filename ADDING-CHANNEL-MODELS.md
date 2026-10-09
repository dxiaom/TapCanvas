# 添加渠道模型操作手册（new-api 网关 + TapCanvas 画布）

> 背景：2026-09-09 为「坤坤」渠道添加 `gpt-image-2.5` / `gpt-image-2.5-flare` 时，漏了「模型目录登记」，
> 导致网关"模型管理"页和画布模型列表都看不到新模型。本文记录完整链路，避免重复踩坑。
>
> 核心认知：**一个模型要真正可用且可见，需要打通 4 层**：
> ① 渠道清单 → ② abilities 路由 → ③ 模型目录（models 表，决定"可见"）→ ④ 计费（options.ModelPrice 或内置规格价表）。

## 快速检查清单

| 层 | 存储位置 | 缺失后果 | 验证方式 |
|---|---|---|---|
| ① 渠道清单 | new-api 库 `channels.models`（逗号分隔） | 请求路由不到该渠道 | 管理 API `GET /api/channel/{id}` |
| ② abilities | new-api 库 `abilities` 表 | `/v1/models` 不显示、请求报"无可用渠道" | `GET /v1/models` |
| ③ 模型目录 | new-api 库 `models` 表 | **模型管理页 + 画布模型列表都看不到**（本次踩坑点） | `GET /api/models/list?enabled=true` |
| ④ 计费 | options 表 `ModelPrice`（USD/次）或内置规格价表（Go 代码） | 计费错误或回落默认倍率 | `GET /api/pricing` |

数据库：new-api 网关 = `tapcanvas_new_api` 库（DSN 在 `/www/tapcanvas/new-api/.env` 的 `SQL_DSN`）；
画布 hono = `tapcanvas` 库（`/www/tapcanvas/api/apps/hono-api/.env` 的 `DATABASE_URL`）。别连错库。

## 一、普通模型（无特殊计价族）——纯 SQL 即可

以渠道 id=4、新模型 `xxx-new` 为例，参照已有同族模型（如 `gpt-image-2`）：

```sql
-- ① 渠道清单追加
UPDATE channels SET models = models || ',xxx-new' WHERE id = 4;

-- ② abilities 复制同族已有模型的行为（分组/优先级/权重/tag 完全一致）
INSERT INTO abilities ("group", model, channel_id, enabled, priority, weight, tag)
SELECT a."group", v.model, a.channel_id, a.enabled, a.priority, a.weight, a.tag
FROM abilities a CROSS JOIN (VALUES ('xxx-new')) AS v(model)
WHERE a.channel_id = 4 AND a.model = 'gpt-image-2';

-- ③ 模型目录登记：复制同族模型的完整行（含 params_def 参数面板定义！）
INSERT INTO models (model_name, description, icon, tags, vendor_id, endpoints, status,
                    sync_official, created_time, updated_time, deleted_at, name_rule,
                    kind, capabilities, params_def, pricing_config)
SELECT 'xxx-new', '描述文案', icon, tags, vendor_id, endpoints, status, sync_official,
       EXTRACT(EPOCH FROM NOW())::bigint, EXTRACT(EPOCH FROM NOW())::bigint,
       deleted_at, name_rule, kind, capabilities, params_def, pricing_config
FROM models WHERE id = 15;  -- 参照模型的 id
```

注意：`models.status` 必须为 1，否则 `/api/pricing` 会直接跳过该模型（updatePricing 里 status!=1 continue）。

## 二、计费（④）

### 情况 A：普通固定价模型
写 options 表 `ModelPrice`（JSON，**单位是 USD/次**）：

```sql
-- 用程序解析 JSON 后追加 key（不要手改正文，容易写坏）：
-- obj["xxx-new"] = 0.2
UPDATE options SET value='<合并后的JSON>' WHERE key='ModelPrice';
```

### 情况 B：与 gpt-image-2 同族的"分辨率×质量"分档模型（本次案例）
gpt-image-2 的实际扣费**不走 ModelPrice**，走 Go 代码里的内置规格价表
（`upstream-new-api/model/pricing_param.go` → `fixedImagePricingRules`，9 档：
1k:low ¥0.3 / 2k:low ¥0.4 / 4k:low ¥0.5 / 1k:medium ¥0.6 / 2k:medium ¥1.2 / 4k:medium ¥1.9 /
1k:high ¥2.3 / 2k:high ¥4.6 / 4k:high ¥7.6，参考图另加 ¥0.1/张）。

同族新模型必须改 **两处 Go 代码**，缺一不可：
1. `fixedImagePricingRules`：加 `case "gpt-image-2.5", "gpt-image-2.5-flare":`（复制 gpt-image-2 的 9 档）
2. `isGptImage2QualityPricingModel`：把新模型的 canonical 加进返回值
   （否则扣费侧不会按 quality 匹配 spec_key，配置了规格价也扣不对）

然后重新编译部署网关（版本号递增，如 `v1.0.0-rc.34-tapcanvas.4`）：

```powershell
# 本地（仓库根 upstream-new-api/）
$env:GOOS='linux'; $env:GOARCH='amd64'; $env:CGO_ENABLED='0'
go build -ldflags "-s -w -X 'github.com/QuantumNous/new-api/common.Version=v1.0.0-rc.34-tapcanvas.N'" -o new-api-rc34-tN .
$env:GOOS='windows'
# 上传用宝塔 MCP Upload 工具（size 必须传真实字节数，否则 LENGTH_MISMATCH）
# 服务器：备份 → mv → chmod 755 → 宝塔 Go 项目 tapcanvas_newapi 重启
```

> 免编译替代方案：models 表 `pricing_config` 字段可以存规格价 JSON
> （schema 见 `model/model_spec_pricing.go` 的 `ModelPricingConfig`：
> `{"currency":"CNY","billing_mode":"fixed_by_spec","specs":[{"spec_key":"image:1k:low","resolution":"1k","price_cny":0.3},...]}`），
> 写库后 1 分钟内生效，不用重新编译。但 gpt-image-2 族的 quality 分档扣费逻辑
> （`isGptImage2QualityPricingModel`）仍是代码判断，纯 JSON 配不齐完整语义。

### 情况 C：停用内置规格价表、改用固定按次价（2026-09-09 实战）

内置规格价表（Go 代码）优先级高于 options.ModelPrice，**直接改 ModelPrice 对已内置规格价的模型无效**。
要让这类模型改按固定价扣费，给 models 表该模型行写 `disabled` 配置：

```sql
UPDATE models SET pricing_config='{"currency":"CNY","billing_mode":"disabled","specs":[]}'
WHERE model_name IN ('gpt-image-2','gpt-image-2.5','gpt-image-2.5-flare');
```

`disabled` 的语义（`model_spec_pricing.go`）：
- 发布侧 `BasePriceCNY()` 返回 (0,false) → `/api/pricing` 回落 options.ModelPrice
- 扣费侧 `FixedPriceCNYBySpecKey` 返回 (0,false) → 回落按次价扣费
- `Validate` 强制 disabled 时参考图计费字段为 0 → 参考图免费

配合 `UPDATE options SET value=... WHERE key='ModelPrice'`（三模型 0.02）后，
`/api/pricing` 三个模型 `model_price: 0.02, quota_type: 1` ✓。缓存 1 分钟自动过期，无需重启。

**注意**：new-api 的价格按模型全局生效、不分渠道。改 gpt-image-2 的价格会影响所有渠道的同名模型。

### 情况 D：固定价的正确姿势——单档规格价（推荐，2026-09-09 实战定稿）

情况 C 的 `disabled` 有一个坑：它把规格价表（specs）整个清空了。**画布的积分计价依赖
`/api/pricing` 的 `param_pricing.specs`**（1 CNY = 100 积分，`TAP_CREDITS_PER_CNY`），
specs 为空时画布生成报 `"模型规格积分价格未配置"`（hono `billing.service.ts`
`model_spec_pricing_unavailable`）。disabled 只修好网关扣费、断掉画布展示链路。

正确姿势：**fixed_by_spec 单档规格价 + ModelPrice 同值兜底**，两层同价：

```sql
-- ① models 表：单档规格价（价格 = 你要的每次价，单位 CNY）
UPDATE models SET pricing_config='{"currency":"CNY","billing_mode":"fixed_by_spec",
  "specs":[{"spec_key":"image:1k","resolution":"1k","price_cny":0.02}]}'
WHERE model_name IN ('gpt-image-2','gpt-image-2.5','gpt-image-2.5-flare');

-- ② options.ModelPrice 同值兜底（回落扣费价，保持与①一致避免展示价≠扣费价）
-- 用程序解析 JSON 追加/更新后写回，同情况 A。
```

三层行为（均已验证）：

| 层 | 行为 |
|---|---|
| 发布（/api/pricing） | `BasePriceCNY()` = 单档价 → `model_price: 0.02, quota_type: 1`，`param_pricing.results` 带 `spec_key: "image:1k"` |
| 画布（hono 快照） | `specCreditsByModelSpecKey["模型:image:1k"] = price_cny × 100` 积分 → 画布规格下拉只有这一档，specKey 原样命中，**不再报未配置** |
| 网关扣费（relay/image_spec_price.go） | quality 分档模型按 `image:1k:low/medium/high` 查 spec_key，单档（无 quality 段）查不中 → 返回 false → **回落 options.ModelPrice 按次扣费** |

换算链：`price_cny × TAP_CREDITS_PER_CNY(100)` = 画布积分价。本例 ¥0.02/次 = **2 积分/次**。
`NEW_API_USD_EXCHANGE_RATE=7.3` 仅用于 USD 计价模型的换算，规格价一律直接用 CNY。

要点回顾：
1. **永远不要用 disabled 当固定价**——它是"显式停用规格计价"，specs 必须空数组，画布必报错
2. 单档规格价的 `spec_key` 建议用 `image:1k`（resolution 级，2 段式）：画布下拉只出这一档、
   specKey 原样回传、exact 命中；不要写带 quality 的 3 段式多档（那会重新引入分档计价）
3. `params_def` 的 `image_size` 参数同步只保留支持的档位（如仅 1K），画布分辨率下拉随之收敛
4. options.ModelPrice 与规格价**保持同值**：规格价 miss 时（如 quality 匹配不上）扣费回落到它，
   两层不同价会造成展示价与扣费价不一致

## 三、验证链路（按顺序）

```bash
# 登录拿 JWT（rc.34 用 access_token，不是 cookie）
TOKEN=$(curl -s -X POST http://127.0.0.1:4455/api/user/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"***"}' | python3 -c "import json,sys;print(json.load(sys.stdin)['data']['access_token'])")

# ① 渠道清单
curl -s -H "Authorization: Bearer $TOKEN" -H 'New-Api-User: 1' http://127.0.0.1:4455/api/channel/4

# ② 路由可见（普通用户视角）
curl -s -H "Authorization: Bearer sk-xxx" http://127.0.0.1:4455/v1/models

# ③ 模型目录（模型管理页 + 画布列表的数据源）
curl -s -H "Authorization: Bearer $TOKEN" -H 'New-Api-User: 1' \
  'http://127.0.0.1:4455/api/models/list?enabled=true&require_video_spec=true'

# ④ 计费发布（model_price = 规格价最低档；同族模型此处应一致）
curl -s http://127.0.0.1:4455/api/pricing
```

画布侧：hono `billing /models` 自动组合网关模型 + 定价 + param_pricing，无需单独登记
（画布的模型 catalog 表 `model_catalog_models` 当前为空，全靠网关自动同步）。
最后刷新画布页面，生成节点模型下拉里应能看到新模型，参数面板与参照模型一致。

## 踩坑记录

1. **models 表漏登记**（本次主坑）：只加渠道+abilities 时，`/v1/models` 和请求路由都正常，
   但"模型管理"页和画布列表以 `/api/models/list`（models 表）为准 → 两处都不可见。
2. **pricing 覆盖顺序**：`updatePricing` 里模型定价优先取 models 表 `pricing_config` / 内置规格价表，
   **options.ModelPrice 会被覆盖**。gpt-image-2 显示 0.3（规格价最低档）而非 ModelPrice 的 0.2 就是这个原因。
   判断"实际生效价"看 `/api/pricing` 的 model_price，不要只看 options 表。
3. **直改库不走缓存广播**：网关配了 Redis + options 定时同步；直接改库后 ability/pricing 缓存
   最多等 1 分钟（pricing）/重启（ abilities 视版本）才刷新。管理后台页面要强刷（Ctrl+F5）。
4. **CanonicalModelKey 别名表**：`gpt-image-2-apimart/-suchuang/-all/-rightcodes/-vip/-pro/-magic666` 等
   后缀别名都归一到 `gpt-image-2`，自动继承其规格价；但 `gpt-image-2.5` 不命中任何后缀规则，
   canonical 是它自己 → **必须显式登记**（这也是它没自动继承定价的原因）。
5. **跨库勿混淆**：网关（tapcanvas_new_api）与画布（tapcanvas）是两个 PostgreSQL 库。

## 相关文件

- 渠道/abilities：new-api 库 `channels` / `abilities` 表
- 模型目录：new-api 库 `models` 表（管理后台"模型管理"页）
- 定价覆盖：`upstream-new-api/model/pricing_param.go`（内置规格价表 + quality 计价族）
- 定价 schema：`upstream-new-api/model/model_spec_pricing.go`（models.pricing_config 的 JSON 契约）
- 端点类型映射：`upstream-new-api/common/endpoint_type.go`（新渠道类型需加映射）
- 部署流程：上传 136MB 二进制（MCP Upload，size 传真实字节数）→ 服务器 mv → 宝塔重启 `tapcanvas_newapi`
