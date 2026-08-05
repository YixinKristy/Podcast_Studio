import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { tasks } from "@trigger.dev/sdk";
import { createClient } from "@/lib/db/supabase/server";
import { createAdminClient } from "@/lib/db/supabase/admin";
import { beginTranscription } from "@/lib/services/episode";
import { deductQuotaForGeneration } from "@/lib/services/quota";
import { getSignedDownloadUrl, getSignedUploadUrl, objectKeyFromUrl } from "@/lib/storage/oss";
import { buildClipUploadSlots } from "@/lib/services/clips/upload-slots";
import type { transcribeEpisode } from "@/trigger/transcribe-episode";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ episodeId: string }> },
) {
  const { episodeId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 });
  }

  // 先原子迁移状态，抢到的那个请求才继续；抢不到说明已经在转写或已完成
  const { data: episode, error: transitionErr } = await beginTranscription(supabase, episodeId);
  if (transitionErr || !episode) {
    return NextResponse.json({ error: "这期已经在处理中，或状态不对" }, { status: 409 });
  }

  const attemptId = randomUUID();
  // quota_ledger 的 RLS 没给用户开写权限，扣额度必须用 service role client（见 lib/services/quota.ts 注释）
  const admin = createAdminClient();
  let deductResult;
  try {
    deductResult = await deductQuotaForGeneration(admin, user.id, episodeId, attemptId);
  } catch (err) {
    await supabase.from("episodes").update({ status: "uploaded" }).eq("id", episodeId);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "扣额度失败" },
      { status: 500 },
    );
  }
  if (!deductResult.ok) {
    // 额度不够，把状态迁移退回去，不占坑
    await supabase.from("episodes").update({ status: "uploaded" }).eq("id", episodeId);
    return NextResponse.json({ error: "本月额度已用完（4/4），下月自动恢复" }, { status: 402 });
  }

  const objectKey = objectKeyFromUrl(episode.audio_url!);
  const monoObjectKey = objectKey.replace(/\.[^./]+$/, "") + ".mono.wav";
  const materialTypes = (episode.generate_materials as string[] | null) ?? [];

  // 切片生成在转写完之后才跑，可能隔了不短的时间，原始音频的下载 URL 得比单纯转写用的
  // 期限长一些；上传槽位也只能现在（Next.js 侧，能安全用 ali-oss 签 URL）提前签好，
  // 任务里不能自己 import lib/storage/oss.ts
  const clipsDownloadUrl = getSignedDownloadUrl(objectKey, 4 * 60 * 60);
  const clipUploadSlots = materialTypes.includes("clips")
    ? buildClipUploadSlots(episode.show_id)
    : undefined;

  await tasks.trigger<typeof transcribeEpisode>("transcribe-episode", {
    episodeId,
    userId: user.id,
    attemptId,
    downloadUrl: clipsDownloadUrl,
    monoUploadUrl: getSignedUploadUrl(monoObjectKey, 2 * 60 * 60),
    monoDownloadUrl: getSignedDownloadUrl(monoObjectKey, 2 * 60 * 60),
    materialTypes,
    clipUploadSlots,
  });

  return NextResponse.json({ ok: true });
}
