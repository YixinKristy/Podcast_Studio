// 任务 1.2 验证任务：证明 Trigger.dev 能扛住"轮询等待 + ffmpeg 执行"这种长任务模式
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import { task, wait, logger } from "@trigger.dev/sdk";

const execFileAsync = promisify(execFile);

export const spikeQueueValidation = task({
  id: "spike-queue-validation",
  maxDuration: 300,
  run: async () => {
    const startedAt = Date.now();

    // 模拟"提交任务后轮询等待"这一段——wait.for 是可持续的等待，不计入 maxDuration 的 CPU 时间
    logger.info("模拟轮询等待 10 秒...");
    await wait.for({ seconds: 10 });

    // 验证 ffmpeg build extension 是否生效：能找到二进制、能真正跑一段音频处理
    const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg";
    const { stdout: versionOutput } = await execFileAsync(ffmpegPath, ["-version"]);
    const ffmpegVersion = versionOutput.split("\n")[0];

    const outputPath = "/tmp/spike-queue-test-tone.wav";
    await execFileAsync(ffmpegPath, [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=2",
      outputPath,
    ]);
    const outputStat = await stat(outputPath);

    logger.info("ffmpeg 验证完成", { ffmpegVersion, outputSizeBytes: outputStat.size });

    return {
      ffmpegVersion,
      outputSizeBytes: outputStat.size,
      elapsedMs: Date.now() - startedAt,
    };
  },
});
