// 任务 1.2 验证脚本：触发 trigger/spike-queue.ts 里的验证任务并等待结果。
// 前提：另开一个终端跑 `npx trigger.dev@4.5.8 dev --env-file .env.local`
import { config } from "dotenv";
config({ path: ".env.local" });

import { tasks, runs } from "@trigger.dev/sdk";
import type { spikeQueueValidation } from "../trigger/spike-queue.ts";

async function main(): Promise<void> {
  console.log("触发 spike-queue-validation 任务...");
  const handle = await tasks.trigger<typeof spikeQueueValidation>("spike-queue-validation", undefined);
  console.log(`run id = ${handle.id}，等待完成...`);

  for await (const run of runs.subscribeToRun<typeof spikeQueueValidation>(handle.id)) {
    console.log(`  状态：${run.status}`);
    if (run.status === "COMPLETED") {
      console.log("\n✅ 完成，输出：", run.output);
      return;
    }
    if (run.status === "FAILED" || run.status === "CRASHED" || run.status === "TIMED_OUT") {
      console.log("\n❌ 任务失败：", run.error);
      process.exitCode = 1;
      return;
    }
  }
}

main().catch((err) => {
  console.error("❌ 触发失败：", err);
  process.exitCode = 1;
});
