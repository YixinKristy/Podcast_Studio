// 宣传切片包：docs/05 Tab6 + docs/13 一。跟文本物料不一样，这个不走 generateMaterial()
// 同步调用，因为还要跑确定性预筛 + ffmpeg 真实切音频，必须在 Trigger.dev 任务里跑
// （Next.js serverless 环境没有 ffmpeg，也扛不住这个耗时）。
// 音频处理跟 transcribe-episode.ts 一个套路：不直接用 ali-oss（打包问题），走签名 URL + fetch——
// 下载/上传用的签名 URL 必须由调用方（Next.js 侧，能安全 import ali-oss 的地方）算好
// 通过 payload 传进来，任务本身不 import lib/storage/oss.ts（连带整个文件都不能碰）。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { task, logger } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { generateStructured } from "@/lib/ai/qwen";
import { buildGenerationContext } from "@/lib/services/materials/context";
import { markGenerating, markFailed, saveNewVersion } from "@/lib/services/materials/store";
import { maybeCompleteGeneration } from "@/lib/services/materials/generate";
import { prescreenCandidates, formatCandidateForPrompt } from "@/lib/services/clips/prescreen";
import { computeTurns, snapClipBoundaries } from "@/lib/services/clips/turns";
import { buildClipsPrompt, clipsSchema } from "@/prompts/clips";
import type { ClipsStoredContent, ClipWithAudio } from "@/prompts/clips";
import { unsignedObjectUrl } from "@/lib/storage/oss-keys";

const execFileAsync = promisify(execFile);

function getAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
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

// docs/05 Tab6 切割实现要求：前后各留 0.3s 呼吸，切点 15ms 淡入淡出防爆音，
// 响度归一到 -16 LUFS，输出 mp3 128kbps 单声道
const PADDING_SECONDS = 0.3;
const FADE_SECONDS = 0.015;

async function cutClip(
  ffmpegPath: string,
  originalPath: string,
  startSeconds: number,
  endSeconds: number,
  outputPath: string,
): Promise<void> {
  const paddedStart = Math.max(0, startSeconds - PADDING_SECONDS);
  const duration = endSeconds + PADDING_SECONDS - paddedStart;
  const fadeOutStart = Math.max(0, duration - FADE_SECONDS);

  await execFileAsync(ffmpegPath, [
    "-y",
    "-ss",
    String(paddedStart),
    "-i",
    originalPath,
    "-t",
    String(duration),
    "-af",
    `afade=t=in:st=0:d=${FADE_SECONDS},afade=t=out:st=${fadeOutStart}:d=${FADE_SECONDS},loudnorm=I=-16:TP=-1.5:LRA=11`,
    "-ac",
    "1",
    "-b:a",
    "128k",
    outputPath,
  ]);
}

export interface GenerateClipsPayload {
  episodeId: string;
  instruction?: string;
  // 原始音频的签名下载 URL，调用方（Next.js 侧）算好传进来
  downloadUrl: string;
  // 预先分配好的一批"objectKey + 签名上传 URL"，够用就行（LLM 最多给 5+2 备用条），
  // 用不完的槽位就是白占了一个没写过数据的 objectKey，无害
  uploadSlots: { objectKey: string; uploadUrl: string }[];
}

export const generateClips = task({
  id: "generate-clips",
  maxDuration: 1800,
  run: async (payload: GenerateClipsPayload) => {
    const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg";
    const supabase = getAdminClient();
    const materialId = await markGenerating(supabase, payload.episodeId, "clips");
    const tmpDir = await mkdtemp(path.join(tmpdir(), "clips-"));

    try {
      const context = await buildGenerationContext(supabase, payload.episodeId);
      if (context.segments.length === 0) {
        throw new Error("没有逐字稿，无法生成切片");
      }

      const candidates = prescreenCandidates(context.segments);
      if (candidates.length === 0) {
        // docs/07 E5：宁可降级产出也不给空态；但连确定性预筛都挑不出候选（比如这期太短），
        // 存个空结果，UI 走"未识别到高光片段"的空态提示，而不是永远转圈
        const empty: ClipsStoredContent = { clips: [], rejected: [] };
        await saveNewVersion(supabase, materialId, empty, "generated");
        return { ok: true, clips: 0 };
      }

      logger.info("确定性预筛完成", { candidates: candidates.length });

      const candidatesText = candidates
        .map((c, i) => formatCandidateForPrompt(c, context.segments, i))
        .join("\n\n");
      const { system, user } = buildClipsPrompt(context, candidatesText, payload.instruction);
      const llmResult = await generateStructured({ system, user, schema: clipsSchema });

      logger.info("LLM 精选完成", {
        clips: llmResult.clips.length,
        rejected: llmResult.rejected.length,
      });

      if (llmResult.clips.length > payload.uploadSlots.length) {
        logger.warn("LLM 给的切片数超过预分配的上传槽位，多出来的丢弃", {
          clips: llmResult.clips.length,
          slots: payload.uploadSlots.length,
        });
      }

      const originalPath = path.join(tmpDir, "original");
      await downloadTo(payload.downloadUrl, originalPath);

      const turns = computeTurns(context.segments);
      const clipsWithAudio: ClipWithAudio[] = [];
      const clipsToProcess = llmResult.clips.slice(0, payload.uploadSlots.length);

      for (let i = 0; i < clipsToProcess.length; i++) {
        const clip = clipsToProcess[i]!;
        const slot = payload.uploadSlots[i]!;
        // docs/10 ★2：LLM 报的时间戳不能直接信，切之前再吸附一次真实语轮边界
        const snapped = snapClipBoundaries(clip.startSeconds, clip.endSeconds, turns);

        const outputPath = path.join(tmpDir, `clip-${i}.mp3`);
        await cutClip(
          ffmpegPath,
          originalPath,
          snapped.startSeconds,
          snapped.endSeconds,
          outputPath,
        );
        await uploadFrom(slot.uploadUrl, outputPath);

        clipsWithAudio.push({
          ...clip,
          startSeconds: snapped.startSeconds,
          endSeconds: snapped.endSeconds,
          audioUrl: unsignedObjectUrl(slot.objectKey),
        });
        logger.info(`切片 ${i + 1}/${clipsToProcess.length} 切割完成`);
      }

      const content: ClipsStoredContent = { clips: clipsWithAudio, rejected: llmResult.rejected };
      await saveNewVersion(
        supabase,
        materialId,
        content,
        payload.instruction ? "reroll" : "generated",
        payload.instruction,
      );

      return { ok: true, clips: clipsWithAudio.length };
    } catch (err) {
      logger.error("切片生成失败", { error: String(err) });
      await markFailed(supabase, materialId);
      return { ok: false };
    } finally {
      await maybeCompleteGeneration(supabase, payload.episodeId).catch(() => {});
      await rm(tmpDir, { recursive: true, force: true });
    }
  },
});
