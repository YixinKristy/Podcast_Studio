# 播客后期分发助手

中文独立播客主的后期工作台：上传成品音频 → AI 生成七件套发布物料（标题/封面图/Shownotes/章节/金句卡/切片/宣传笔记）→ 复制发布。

## 规格文档（改代码前必读相关章节）
- docs/05-PRD.md — 页面详设与交互（唯一事实源）
- docs/07-链路闭环与异常策略.md — 所有异常分支的处理策略，实现时逐条对照
- docs/09-工程准备与开发规范.md — 技术栈、目录结构、测试策略
- docs/10-roughcut-stdio借鉴分析.md — 切片选段算法的设计依据

## 技术栈
Next.js 15 App Router + TypeScript strict / Tailwind + shadcn/ui / Zustand + React Query
Supabase（Postgres + Auth OTP + RLS）/ 阿里云 OSS / 百炼 Fun-ASR + Qwen / ffmpeg / Vitest + Playwright

## 架构铁律（违反即返工）
1. **API 路由保持薄**：业务逻辑全在 `lib/services/`，纯函数优先，这是能写单测的前提
2. **物料生成器统一基类**：七种物料共享 `generate / regenerate(instruction) / validate / version` 接口。禁止每个 Tab 各写一套
3. **prompt 与代码分离**：全部放 `prompts/*.ts`，改 prompt 不改逻辑
4. **时间戳单一来源**：所有物料时间戳从 transcript segments 派生，禁止各自计算
5. **RLS 从第一张表就开**，不留"以后再加"
6. **所有写操作幂等**：重试不产生重复物料、不重复扣额度
7. **外部响应必过 zod 校验**：LLM 输出尤其重要，坏数据自动重试 1 次

## 关键业务规则
- 额度：4 期/月，在"开始生成"时扣减；转写失败/文件损坏自动冲正
- 状态机：draft → uploaded → transcribing → generating → ready ⇄ published，任一 *_failed 可重入
- 逐字稿修正后**不自动重跑**物料，只标记"建议刷新"
- 切片选段用两级漏斗：确定性信号预筛 top15-20 → LLM 精选。禁止全稿直接喂 LLM
- 切片边界吸附**语轮**（不是句子），问答必须成对
- 失败降级优于报错：低置信也要产出并如实标注

## 代码规范
- 禁止 any（用 unknown + 类型守卫）；Conventional Commits；一个 PR 一个可验收功能点
- service 层抛类型化错误 → API 层映射为用户可读中文文案（文案见 docs/07）
- PR 描述必须写「怎么验」的步骤

## 测试
必写单测：额度扣减与冲正、状态机流转、时间戳映射、LLM 输出 schema 校验、发布包拼装、切片边界吸附
E2E：主流程一条 + 转写失败重试一条（验证额度未被吞）
不写：UI 样式、第三方 SDK 内部行为
