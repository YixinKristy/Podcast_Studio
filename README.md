# 播客后期分发助手

中文独立播客主的后期工作台：上传成品音频 → AI 生成七件套发布物料（标题/封面图/Shownotes/章节/金句卡/切片/宣传笔记）→ 复制发布。

规格文档见 [`docs/`](docs/)，架构约束见 [`CLAUDE.md`](CLAUDE.md)。

## 技术栈

Next.js 15 App Router + TypeScript strict / Tailwind v4 + shadcn/ui / Supabase（Postgres + Auth + RLS）/ 阿里云 OSS / 百炼 Fun-ASR + Qwen / Trigger.dev + ffmpeg / Vitest + Playwright

## 本地启动

```bash
npm install
cp .env.example .env.local   # 然后把 .env.local 里的 key 填好
npm run dev
```

打开 http://localhost:3000。

## 常用命令

| 命令                              | 作用                                                                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                     | 本地开发服务器（Turbopack）                                                                                                                    |
| `npm run build`                   | 生产构建（这台机器上 `--turbopack` 构建会因 lightningcss 原生模块问题失败，`build` 用的是普通 webpack 构建；`dev` 不受影响，继续用 Turbopack） |
| `npm run lint`                    | ESLint                                                                                                                                         |
| `npm run format` / `format:write` | Prettier 检查 / 自动格式化                                                                                                                     |
| `npm run typecheck`               | TypeScript 严格模式类型检查                                                                                                                    |
| `npm run test`                    | Vitest 单测                                                                                                                                    |
| `npm run test:integration`        | Supabase RLS 越权测试，需要真实项目凭证（见下面「数据库」）                                                                                    |
| `npm run test:e2e`                | Playwright E2E（首次需要 `npx playwright install --with-deps chromium`）                                                                       |

## 数据库

Schema 用 Supabase CLI 管理，迁移文件在 `supabase/migrations/`。

```bash
SUPABASE_ACCESS_TOKEN=<个人访问令牌> supabase link --project-ref <project ref> --password '<数据库密码>'
SUPABASE_ACCESS_TOKEN=<个人访问令牌> supabase db push          # 应用迁移
SUPABASE_ACCESS_TOKEN=<个人访问令牌> supabase gen types typescript --linked > lib/db/database.types.ts
```

个人访问令牌在 [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) 生成。这台机器没装 Docker，所以本地开发和 RLS 测试都是直接连真实项目，不是 `supabase start` 本地栈——`npm run test:integration` 会真的在项目里建两个测试用户验证越权，跑完自动清理。

## 独立验证脚本（不属于主应用）

这两个脚本是任务 1.1/1.2 的技术验证产物，不接入主应用的业务逻辑：

- `npm run spike-asr -- <本地音频路径>` — 验证 Fun-ASR 转写链路（ffprobe → 转单声道 → OSS → Fun-ASR → 落盘），结果见 [`docs/decisions/asr-spike-results.md`](docs/decisions/asr-spike-results.md)
- `npm run trigger:dev` 起 Trigger.dev 本地 dev server 后，`npm run spike-queue` 验证长任务队列方案，结论见 [`docs/decisions/queue.md`](docs/decisions/queue.md)

## 目录结构

```
app/            # Next.js App Router 路由；(marketing) 落地页，(app) 登录后功能，api 路由处理器
components/     # ui(shadcn 基础件) / studio(发布台组件) / material(七物料统一契约组件)
lib/            # 业务逻辑：services(状态机/额度/时间戳/七种物料生成器) / ai / asr / storage / db
jobs/           # 异步任务（转写/生成/切片）
prompts/        # LLM prompt 模板，独立于代码，可版本化
scripts/        # 独立验证脚本（spike-asr、spike-queue），不进主应用
trigger/        # Trigger.dev 任务定义
tests/          # unit(Vitest) / integration(RLS 等需要真实凭证的测试) / fixtures(回归测试样本) / e2e(Playwright)
docs/           # 产品规格文档 + 技术决策记录（docs/decisions/）
supabase/       # 数据库迁移文件（supabase/migrations/）+ CLI 配置
```

## CI

GitHub Actions（`.github/workflows/ci.yml`）在每个 PR 上跑四项门禁：`lint`、`typecheck`、`test`（Vitest 单测）、`test-integration`（Supabase RLS，走仓库 secrets 里的真实项目凭证）。
