// 粗剪音频渲染：docs/04 §1 Stage 1"第一步·导出优先"。跟 generate-clips.ts 一个套路——
// 真实 ffmpeg 处理音频，必须在 Trigger.dev 任务里跑，不能碰 lib/storage/oss.ts
// （ali-oss 打包问题），签名 URL 由调用方（Next.js 侧）提前算好通过 payload 传进来。
//
// 产出的是"粗剪半成品"，不是发布成品——目的是让用户拖进剪映等工具继续精修，
// 所以不做响度归一/不强制单声道，尽量保留原始音质，只在剪切点做短淡入淡出防爆音。
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { task, logger } from "@trigger.dev/sdk";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { computeKeptRanges } from "@/lib/services/roughcut/ranges";
import type { StoredSuggestion, StoredStructuralAnalysis } from "@/lib/services/roughcut/generate";
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

const FADE_SECONDS = 0.02;

async function extractKeptSegment(
  ffmpegPath: string,
  originalPath: string,
  outputPath: string,
  range: { startSeconds: number; endSeconds: number; fadeIn: boolean; fadeOut: boolean },
): Promise<void> {
  const duration = range.endSeconds - range.startSeconds;
  const filters: string[] = [];
  if (range.fadeIn) filters.push(`afade=t=in:st=0:d=${FADE_SECONDS}`);
  if (range.fadeOut) {
    filters.push(`afade=t=out:st=${Math.max(0, duration - FADE_SECONDS)}:d=${FADE_SECONDS}`);
  }

  const args = [
    "-y",
    "-ss",
    String(range.startSeconds),
    "-i",
    originalPath,
    "-t",
    String(duration),
  ];
  if (filters.length > 0) args.push("-af", filters.join(","));
  args.push(outputPath);

  await execFileAsync(ffmpegPath, args);
}

export interface RenderRoughCutPayload {
  episodeId: string;
  downloadUrl: string;
  objectKey: string;
  uploadUrl: string;
}

export const renderRoughCut = task({
  id: "render-rough-cut",
  maxDuration: 1800,
  run: async (payload: RenderRoughCutPayload) => {
    const ffmpegPath = process.env.FFMPEG_PATH ?? "ffmpeg";
    const supabase = getAdminClient();
    const tmpDir = await mkdtemp(path.join(tmpdir(), "roughcut-"));

    const { data: roughCut } = await supabase
      .from("rough_cuts")
      .select("id, suggestions, structural_analysis")
      .eq("episode_id", payload.episodeId)
      .single();
    if (!roughCut) {
      logger.error("找不到粗剪记录", { episodeId: payload.episodeId });
      return { ok: false };
    }

    await supabase
      .from("rough_cuts")
      .update({ render_status: "generating", updated_at: new Date().toISOString() })
      .eq("id", roughCut.id);

    try {
      const { data: episode } = await supabase
        .from("episodes")
        .select("duration_seconds")
        .eq("id", payload.episodeId)
        .single();
      const totalDuration = episode?.duration_seconds ?? 0;
      if (totalDuration <= 0) throw new Error("这期还没有时长信息，无法渲染粗剪");

      const suggestions = roughCut.suggestions as unknown as StoredSuggestion[];
      const structuralAnalysis =
        roughCut.structural_analysis as unknown as StoredStructuralAnalysis | null;
      // 段落级取舍（Pass 1+2）只有 delete / pick_one 两种决策代表"真的要剪掉"，
      // keep/compress/move_to_intro 都不产出可执行的剪切区间（compress 没有句级时间点，
      // move_to_intro 是建议不自动执行）
      const segmentCutRanges = (structuralAnalysis?.segments ?? [])
        .filter((s) => s.selected && (s.action === "delete" || s.action === "pick_one"))
        .map((s) => ({ startSeconds: s.startSeconds, endSeconds: s.endSeconds }));
      const cutRanges = [
        ...suggestions
          .filter((s) => s.selected)
          .map((s) => ({ startSeconds: s.startSeconds, endSeconds: s.endSeconds })),
        ...segmentCutRanges,
      ];

      const keptRanges = computeKeptRanges(cutRanges, totalDuration);
      if (keptRanges.length === 0) {
        throw new Error("勾选的建议覆盖了整段音频，没有可以保留的内容——检查一下勾选");
      }

      logger.info("计算出保留区间", { count: keptRanges.length });

      const originalPath = path.join(tmpDir, "original");
      await downloadTo(payload.downloadUrl, originalPath);

      const segmentPaths: string[] = [];
      for (let i = 0; i < keptRanges.length; i++) {
        const segPath = path.join(tmpDir, `seg-${i}.wav`);
        await extractKeptSegment(ffmpegPath, originalPath, segPath, keptRanges[i]!);
        segmentPaths.push(segPath);
      }

      let finalWavPath = segmentPaths[0]!;
      if (segmentPaths.length > 1) {
        const listPath = path.join(tmpDir, "concat.txt");
        const listContent = segmentPaths.map((p) => `file '${p}'`).join("\n");
        await writeFile(listPath, listContent);

        finalWavPath = path.join(tmpDir, "combined.wav");
        await execFileAsync(ffmpegPath, [
          "-y",
          "-f",
          "concat",
          "-safe",
          "0",
          "-i",
          listPath,
          "-c",
          "copy",
          finalWavPath,
        ]);
      }

      const outputPath = path.join(tmpDir, "roughcut.mp3");
      await execFileAsync(ffmpegPath, ["-y", "-i", finalWavPath, "-b:a", "192k", outputPath]);

      await uploadFrom(payload.uploadUrl, outputPath);

      await supabase
        .from("rough_cuts")
        .update({
          render_status: "ready",
          audio_url: unsignedObjectUrl(payload.objectKey),
        })
        .eq("id", roughCut.id);

      logger.info("粗剪音频渲染完成", { segments: keptRanges.length });
      return { ok: true };
    } catch (err) {
      logger.error("粗剪音频渲染失败", { error: String(err) });
      await supabase
        .from("rough_cuts")
        .update({ render_status: "failed", updated_at: new Date().toISOString() })
        .eq("id", roughCut.id);
      return { ok: false };
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  },
});
