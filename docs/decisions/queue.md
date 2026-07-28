# 队列/长任务方案（任务 1.2）

日期：2026-07-28

## 结论：选 Trigger.dev

## 为什么不只看文档，而是直接实测

网页查询工具当时不可用，没法拿到三个平台最新的定价数字。与其在决策文档里写没验证过的数字，改成直接写一个最小验证任务实测关键问题：**wait 能不能撑住长轮询、ffmpeg 能不能真的跑起来**。这比读营销页面可靠。

## 验证方法与结果

写了 `trigger/spike-queue.ts`：`wait.for({ seconds: 10 })` 模拟"提交任务后轮询等待"，然后用子进程实际执行 ffmpeg 生成一段音频（不是只跑 `--version`）。用 `trigger.config.ts` 里官方的 `ffmpeg()` build extension 接入 ffmpeg，无需自己写 Dockerfile。

```
run id = run_06fqh66gfnd5fg42nocgdhui01
DEQUEUED → EXECUTING → COMPLETED
ffmpegVersion: ffmpeg version 8.1.2
outputSizeBytes: 176478
elapsedMs: 12348
```

跑通了。两个当初最担心的问题都有官方支持：

1. **ffmpeg 支持**：`@trigger.dev/build/extensions/core` 里有官方 `ffmpeg()` 扩展，默认装 apt 版本，也可指定 7.x 静态编译版本。不需要自己维护容器镜像。
2. **20 分钟轮询会不会超时**：官方文档确认 `maxDuration` 只计算真正占用 CPU 的时间，`wait.for` / `triggerAndWait` 期间的等待**不计入** maxDuration。也就是说转写轮询这种"大部分时间在等、不占计算资源"的场景，天然不会撞到超时上限。

## 三个候选方案对比

| | Trigger.dev | Railway / Fly.io 自建 worker | 阿里云函数计算(FC) |
|---|---|---|---|
| ffmpeg 支持 | ✅ 官方 build extension，已实测跑通 | ✅ 自己装，100%可控 | 未验证（阿里云控制台里"OSS 对象FC接入点"是另一个不相关功能，用于拦截 GET 请求做实时转换，不是我们需要的通用长任务运行环境；真正的函数计算产品还没实测） |
| 长轮询超时 | ✅ wait 不计入 maxDuration，已确认 | 无限制（自己的进程） | 未验证 |
| 接入 Next.js 复杂度 | 最低：SDK 直接调用，自带看板/重试/日志 | 中：需自己写队列机制 | 中高：需自己写触发逻辑和监控 |
| 运维负担 | 最低 | 较高（进程崩溃恢复、日志） | 中等 |
| 供应商数量 | +1（新增账号） | +1（新增账号，且不再有长期免费层） | +0（已在用阿里云） |
| 定价 | 有免费额度，超出按用量计费（具体数字未做最新核实） | 已取消长期免费层，起步需绑卡（具体数字未做最新核实） | 未核实 |

## 推荐理由

选 Trigger.dev 作为 W1 的实现方案：

- 两个硬指标（ffmpeg、长轮询）都已经用真实代码跑通，不是猜测
- 团队只有 Yi + Claude Code，没有专职运维，Trigger.dev 把重试、日志、看板这些都做掉了，运维负担最低
- 集成方式对 Next.js 最友好：类型安全的 SDK，`tasks.trigger()` 一行代码触发

## 遗留问题 / 后续可能重新评估的点

- **未核实最新定价**：网页工具当时故障，免费额度和超出后的计费方式建议在正式接入前去 [trigger.dev/pricing](https://trigger.dev/pricing) 核实一遍，避免超预算
- **阿里云函数计算（FC）作为长期成本优化方向**：等后续做"切片"功能（1.7 之后）时，如果 ffmpeg 需要频繁从 OSS 下载完整音频处理，且产生的公网出流量费用变得可观，可以重新评估把这部分 worker 迁移到阿里云 FC——同区域内网访问能省掉这部分流量费。这不阻塞现在的开发，等有真实流量数据再看
- 阿里云控制台里的"OSS 对象 FC 接入点"不是我们需要的东西（那是拦截 GET 请求做实时数据转换的功能），如果以后真要评估阿里云 FC，入口是"函数计算"这个独立产品，不是从 OSS 里进
