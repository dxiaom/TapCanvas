# 开放注册设计（公开商业产品）

日期：2026-09-02
状态：已确认方案 A（复活现有链路 + 补齐缺口），技术决策由 AI 代理用户裁定

## 目标

将 TapCanvas 从"仅管理员账号登录"开放为公开商业产品的用户注册体系。用户可自助注册，注册即获体验积分，管理员入口弱化但保留。

## 登录方式矩阵（最终态）

| 方式 | 注册/登录 | 入口位置 | 前置配置 |
|---|---|---|---|
| 邮箱验证码（主） | 登录即注册 | 登录页默认 Tab | ALIYUN_EMAIL_* |
| 微信公众号扫码 | 登录即注册 | 登录页 Tab 2（未配置自动隐藏） | WECHAT_OFFICIAL_* |
| GitHub OAuth | 登录即注册 | 登录页底部图标按钮（未配置隐藏） | GITHUB_CLIENT_ID/SECRET + VITE_GITHUB_CLIENT_ID |
| 邮箱+密码（可选） | 仅登录（首次密码登录后设置） | 「账号密码登录」弱化链接 | 无 |
| 管理员账号密码 | 登录 | 与密码登录同一表单 | TAPCANVAS_ADMIN_* |
| 游客登录 | 不恢复 | 无 | — |

## 后端改动

### 1. 恢复邮箱验证码登录
- `auth.routes.ts` 的 `/email/request`、`/email/verify` 移除 410，恢复调用现存 `requestEmailLoginCode` / `verifyEmailLoginCode`
- 验证码登录成功 → `persistLoginUser` 自动建档（login=邮箱本地部分）→ 登录即注册
- 邮件走阿里云邮件推送（`ALIYUN_EMAIL_ACCESS_KEY_ID/SECRET/FROM`），未配置返回 501 + missing 清单（零兜底）
- 部署时需执行数据库 schema 更新（`email_login_codes` 表）

### 2. OTP 防滥用（新增，公开上线必需）
- `/email/request`：同邮箱 60s 1 次 + 同邮箱 10 次/小时 + 同 IP 30 次/小时（Redis 计数，超限 429 显式文案）
- `/email/verify`：同邮箱连续失败 5 次锁定 15 分钟

### 3. 注册赠送积分（可配）
- 新用户建档点（`auth.service.ts` persistLoginUser created=true 分支）：
  - 有邀请码 → 现有 `bindReferrerOnRegister`（`invitee_welcome_credits`，幂等）不动
  - 无邀请码 → 新增 `grantRegistrationWelcomeCredits`：读配置键 `registration_welcome_credits`（默认 100，0=关闭），复用 `topUpTeamCredits`，`taskId: registration-welcome:${userId}` 幂等
  - 有邀请码与无邀请码奖励互斥，防双重薅
- 管理端 `adminReferralRouter` 扩展 `registration_welcome_credits` 配置读写

### 4. 可选密码
- `POST /auth/password/set`（登录态首次设置，无旧密码）
- `PUT /auth/password`（登录态修改，需旧密码）
- 找回 = 验证码重新登录后改密码，不做独立找回流程
- 强度 ≥8 位；`/auth/login` 密码登录保持现状（管理员与设过密码的用户共用）

### 5. 不动
- guest 保持 410；微信扫码与 GitHub 路由已可用

## 前端改动

### 登录面板重构（apps/web/src/auth/）
- `LoginForm.tsx` → 多 Tab 面板：
  - Tab 1「验证码登录」（默认）：邮箱 → 发送验证码（60s 倒计时）→ 输入 6 位码 → 登录
  - Tab 2「微信扫码」：`createWechatLoginSession` 二维码 + 轮询 `getWechatLoginStatus` → `consumeWechatLoginSession`；后端 501 时隐藏此 Tab
  - 底部 GitHub 图标按钮（`VITE_GITHUB_CLIENT_ID` 为空时隐藏，走现有 `/oauth/github` 回调）
  - 「账号密码登录」小链接 → 现有账号密码表单（管理员 + 设过密码的用户共用）
- 默认密码提示块（admin/123456）仅在 `import.meta.env.DEV` 显示，生产移除
- API 绑定（server.ts 的 `requestEmailLoginCode` 等）已存在，直接接 UI
- 错误一律显式展示后端文案（429/501/锁定提示），无静默降级

## 部署前置（用户提供）

1. 阿里云邮件推送：AccessKey、发信地址（发信域名需配置 SPF/DKIM）→ 服务器 env `ALIYUN_EMAIL_*`
2. 微信公众号（认证服务号）：`WECHAT_OFFICIAL_APP_ID/SECRET/TOKEN`
3. GitHub OAuth App：callback `https://huabu.wavee.cn/oauth/github` → 后端 `GITHUB_CLIENT_ID/SECRET`，前端 `.env.production` `VITE_GITHUB_CLIENT_ID`
4. 服务器执行数据库 schema 更新；hono-api 重新构建上传；前端重新部署 EdgeOne（剔除 ffmpeg-core.wasm）

## 安全要点

- OTP：验证码 SHA256 哈希存储（已有）+ 新增限流/锁定
- 积分发放幂等（taskId 去重），互斥防薅
- 自动建档用户 role=member（非管理员）
- 生产不暴露默认管理员密码

## 测试

- 后端 vitest：注册积分发放（有/无邀请码、幂等、金额为 0）、OTP 限流、密码 set/update 校验
- 前端 vitest：登录面板 Tab 切换、验证码倒计时、未配置方式隐藏
- 回归：管理员密码登录、邀请绑定、签到
