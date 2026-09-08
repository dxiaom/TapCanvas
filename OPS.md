# 部署运维速查（OPS）

本文件记录 TapCanvas 线上部署的关键信息，避免重复询问。

## 前端（腾讯 EdgeOne / EO）

- 站点域名：`https://huabu.wavee.cn`
- **EO Makers 项目名：`huabu-wavee`**
- ProjectId：`makers-nv7s6ndbbbax`（记录于 `.edgeone/project.json`）
- 部署方式：本地构建后 `edgeone makers deploy -n huabu-wavee apps/web/dist`
  - 登录：`edgeone whoami`（Mcnet 董晓星, APPID 1258300241）
- 构建命令：`pnpm --filter @tapcanvas/web build`

## 后端 hono-api（宝塔服务器）

- 服务器路径：`/www/tapcanvas/api/apps/hono-api/`
- 进程入口：`dist/main.js`（端口 8788）
- 启动脚本：`tapcanvas_api_start.sh`（含全部环境变量；启动其他 worker 用 `tapcanvas_async_image_start.sh` / `tapcanvas_workflow_runtime_start.sh` / `tapcanvas_credit_worker_start.sh`）
- 日志：`/www/wwwlogs/nodejs/tapcanvas_api.log`
- 部署方式：本地 `pnpm build` → 上传 dist zip → 覆盖 `dist/` → 重启进程（kill 旧 PID + 执行启动脚本）
- 注意：生产环境变量同时存在于 `.env` 与 `tapcanvas_api_start.sh`，两处都要维护

## new-api（宝塔服务器）

- 服务器路径：`/www/tapcanvas/new-api/`，二进制 `new-api`，端口 4455
- 回滚备份：`new-api.bak-rc26-*`
- 内部 token（hono-api 调用）：见 hono-api 的 `NEW_API_INTERNAL_TOKEN`

## 数据库 / Redis

- new-api PostgreSQL：`tapcanvas_new_api`（详见启动脚本 `NEW_API_SQL_DSN`）
- hono-api PostgreSQL：`tapcanvas`（`DATABASE_URL`）
- Redis：`127.0.0.1:6379`（详见启动脚本 `REDIS_URL`）
- `users.phone` 有部分唯一索引 `users_phone_unique`（`WHERE phone IS NOT NULL AND deleted_at IS NULL`）

## 手机号短信登录/注册（阿里云短信认证服务）

- 阿里云配置在启动脚本与 `.env`：`ALIYUN_SMS_ACCESS_KEY_ID/SECRET`、`ALIYUN_SMS_SIGN_NAME=速通互联验证平台`、`ALIYUN_SMS_TEMPLATE_CODE=100001`（登录/注册模板，含 `${code}`/`${min}` 变量）
- RAM 子账号需授权 `dypns:SendSmsVerifyCode` / `dypns:CheckSmsVerifyCode`
- 频控：阿里云侧同号码 60s 内不可重发（`biz.FREQUENCY`），错误码已映射中文文案
- 注意：Node 环境新增环境变量必须在 `src/platform/node/node-env.ts` 显式映射才会进入 `env`
