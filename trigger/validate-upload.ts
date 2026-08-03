// 上传完成后的轻量校验：C2（ffprobe 探测损坏）+ C10（视频轨自动抽音频）。
// 注意：单声道转换不在这里做——那是"送 ASR 前"的步骤，属于任务 1.7 转写任务的范围，
// 避免在这里重复实现一遍 ffprobe+ffmpeg 逻辑。
//
// 不直接用 ali-oss：它依赖的 urllib 里有个动态 require("proxy-agent")，
// Trigger.dev 的 esbuild 打包过不去。改成走签名 URL + fetch，OSS SDK 留在 Next.js API 路由那边。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { task, logger } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";

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
  if (!res.ok || !res.body) {
    throw new Error(`下载失败 HTTP ${res.status}`);
  }
  await pipeline(
    Readable.fromWeb(res.body as import("stream/web").ReadableStream),
    createWriteStream(destPath),
  );
}

async function uploadFrom(url: string, filePath: string): Promise<void> {
  const { readFile } = await import("node:fs/promises");
  const body = await readFile(filePath);
  const res = await fetch(url, { method: "PUT", body });
  if (!res.ok) {
    throw new Error(`上传失败 HTTP ${res.status}`);
  }
}

interface ProbeStream {
  codec_type: string;
}

export const validateUpload = task({
  id: "validate-upload",
  maxDuration: 600,
  run: async (payload: {
    episodeId: string;
    downloadUrl: string;
    extractedUploadUrl: string;
    extractedObjectKey: string;
  }) => {
    const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg";
    const ffprobePath = process.env.FFPROBE_PATH ?? "ffprobe";
    const supabase = getAdminClient();

    const tmpDir = await mkdtemp(path.join(tmpdir(), "validate-upload-"));
    const localPath = path.join(tmpDir, "original");

    try {
      logger.info("下载原始文件用于校验");
      await downloadTo(payload.downloadUrl, localPath);

      let probeResult: { streams: ProbeStream[] };
      try {
        const { stdout } = await execFileAsync(ffprobePath, [
          "-v",
          "error",
          "-print_format",
          "json",
          "-show_entries",
          "stream=codec_type",
          localPath,
        ]);
        probeResult = JSON.parse(stdout);
      } catch {
        // C2：ffprobe 都读不出来，判定为损坏，不计额度（额度只在"开始生成"时扣，这里还没到那一步）
        logger.warn("ffprobe 失败，判定文件损坏", { episodeId: payload.episodeId });
        await supabase
          .from("episodes")
          .update({ status: "transcribe_failed" })
          .eq("id", payload.episodeId);
        return { ok: false, reason: "corrupted" as const };
      }

      const hasAudio = probeResult.streams?.some((s) => s.codec_type === "audio");
      const hasVideo = probeResult.streams?.some((s) => s.codec_type === "video");

      if (!hasAudio) {
        logger.warn("没有音频轨，判定文件损坏", { episodeId: payload.episodeId });
        await supabase
          .from("episodes")
          .update({ status: "transcribe_failed" })
          .eq("id", payload.episodeId);
        return { ok: false, reason: "no_audio_stream" as const };
      }

      if (!hasVideo) {
        return { ok: true, extractedVideo: false };
      }

      // C10：含视频轨，抽音频轨，原始文件不动，另存一份纯音频
      logger.info("检测到视频轨，抽取音频", { episodeId: payload.episodeId });
      const extractedPath = path.join(tmpDir, "audio-only.m4a");
      await execFileAsync(ffmpegPath, [
        "-y",
        "-i",
        localPath,
        "-vn",
        "-acodec",
        "copy",
        extractedPath,
      ]);
      await uploadFrom(payload.extractedUploadUrl, extractedPath);

      const ossBaseUrl = `https://${process.env.ALIYUN_OSS_BUCKET}.${process.env.ALIYUN_OSS_REGION}.aliyuncs.com`;
      await supabase
        .from("episodes")
        .update({ audio_url: `${ossBaseUrl}/${payload.extractedObjectKey}` })
        .eq("id", payload.episodeId);

      return { ok: true, extractedVideo: true };
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  },
});
