// 转写任务：docs/07 D1/D2/D3/D4/D6。
// 跟 validate-upload.ts 一样不直接用 ali-oss（打包问题），走签名 URL + fetch。
// D2（worker 心跳/崩溃重入队）：交给 Trigger.dev 平台本身处理，这是选它做队列方案的原因之一
// （见 docs/decisions/queue.md），没有再自己写一套心跳机制。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { task, tasks, logger, wait } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { transcribeAudio, FunAsrError } from "@/lib/asr/fun-asr";
import {
  parseSegments,
  voiceActivityRatio,
  countSpeakers,
  isLowConfidence,
} from "@/lib/services/transcript";
import { refundQuotaForFailure } from "@/lib/services/quota";
import type { generateMaterials } from "./generate-materials";

const execFileAsync = promisify(execFile);

function getAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}

async function downloadTo(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}`);
  await pipeline(
    Readable.fromWeb(res.body as import("stream/web").ReadableStream),
    createWriteStream(destPath),
  );
}

async function uploadFrom(url: string, filePath: string): Promise<void> {
  const body = await readFile(filePath);
  const res = await fetch(url, { method: "PUT", body });
  if (!res.ok) throw new Error(`上传失败 HTTP ${res.status}`);
}

interface ProbeInfo {
  channels: number;
  durationSeconds: number;
  [key: string]: unknown;
}

async function probe(filePath: string): Promise<ProbeInfo> {
  const ffprobePath = process.env.FFPROBE_PATH ?? "ffprobe";
  const { stdout } = await execFileAsync(ffprobePath, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=channels:format=duration",
    filePath,
  ]);
  const parsed = JSON.parse(stdout);
  return {
    channels: Number(parsed.streams?.[0]?.channels ?? 1),
    durationSeconds: Number(parsed.format?.duration ?? 0),
  };
}

async function markFailed(
  supabase: ReturnType<typeof getAdminClient>,
  episodeId: string,
  userId: string,
  attemptId: string,
  refundReason: "transcribe_failed" | "no_voice",
) {
  await supabase.from("episodes").update({ status: "transcribe_failed" }).eq("id", episodeId);
  await refundQuotaForFailure(supabase, userId, episodeId, attemptId, refundReason);
}

export const transcribeEpisode = task({
  id: "transcribe-episode",
  maxDuration: 3600,
  run: async (payload: {
    episodeId: string;
    userId: string;
    attemptId: string;
    downloadUrl: string;
    monoUploadUrl: string;
    monoDownloadUrl: string;
    materialTypes: string[];
  }) => {
    const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg";
    const supabase = getAdminClient();
    const tmpDir = await mkdtemp(path.join(tmpdir(), "transcribe-"));
    const originalPath = path.join(tmpDir, "original");

    try {
      logger.info("下载音频");
      await downloadTo(payload.downloadUrl, originalPath);

      const info = await probe(originalPath);
      logger.info("探测完成", info);

      // 提前写 duration_seconds，P3 页面"转写中"阶段的动态预估（约音频时长 1/4）用得到，
      // 不用等整个转写完成
      await supabase
        .from("episodes")
        .update({ duration_seconds: Math.round(info.durationSeconds) })
        .eq("id", payload.episodeId);

      let asrAudioUrl = payload.downloadUrl;
      if (info.channels > 1) {
        // 硬约束 ★1：说话人分离仅支持单声道
        logger.info("转单声道");
        const monoPath = path.join(tmpDir, "mono.wav");
        await execFileAsync(ffmpegPath, ["-y", "-i", originalPath, "-ac", "1", monoPath]);
        await uploadFrom(payload.monoUploadUrl, monoPath);
        asrAudioUrl = payload.monoDownloadUrl;
      }

      // D1：ASR 服务超时/报错，自动重试 1 次（间隔 1min），仍败则终止
      let raw;
      try {
        raw = await transcribeAudio(asrAudioUrl, (status) => logger.info("轮询中", { status }));
      } catch (firstErr) {
        logger.warn("转写第一次失败，1 分钟后重试", { error: String(firstErr) });
        await wait.for({ seconds: 60 });
        try {
          raw = await transcribeAudio(asrAudioUrl, (status) =>
            logger.info("轮询中（重试）", { status }),
          );
        } catch (secondErr) {
          logger.error("转写重试后仍失败", { error: String(secondErr) });
          await markFailed(
            supabase,
            payload.episodeId,
            payload.userId,
            payload.attemptId,
            "transcribe_failed",
          );
          return { ok: false, reason: "asr_failed" as const };
        }
      }

      const segments = parseSegments(raw);

      // D4：有效语音占比 <10%，判定没识别到足够的人声，终止且不计额度
      const activity = voiceActivityRatio(segments, info.durationSeconds);
      if (activity < 0.1) {
        logger.warn("语音占比过低", { activity });
        await markFailed(
          supabase,
          payload.episodeId,
          payload.userId,
          payload.attemptId,
          "no_voice",
        );
        return { ok: false, reason: "no_voice" as const };
      }

      const speakerCount = countSpeakers(segments); // D6：单说话人由前端根据这个字段隐藏说话人标签
      const lowConfidence = isLowConfidence(segments); // D3

      await supabase
        .from("episodes")
        .update({
          transcript: segments,
          duration_seconds: Math.round(info.durationSeconds),
          speaker_count: speakerCount,
          low_confidence: lowConfidence,
          status: "generating",
        })
        .eq("id", payload.episodeId);

      logger.info("转写完成", { segments: segments.length, speakerCount, lowConfidence });

      if (payload.materialTypes.length > 0) {
        await tasks.trigger<typeof generateMaterials>("generate-materials", {
          episodeId: payload.episodeId,
          materialTypes: payload.materialTypes,
        });
      }

      return { ok: true, segments: segments.length };
    } catch (err) {
      logger.error("转写任务异常", {
        error: err instanceof FunAsrError ? err.message : String(err),
      });
      await markFailed(
        supabase,
        payload.episodeId,
        payload.userId,
        payload.attemptId,
        "transcribe_failed",
      );
      return { ok: false, reason: "unexpected_error" as const };
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  },
});
