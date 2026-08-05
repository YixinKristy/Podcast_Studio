import { NextResponse } from "next/server";
import { tasks } from "@trigger.dev/sdk";
import { createClient } from "@/lib/db/supabase/server";
import { getSignedDownloadUrl, getSignedUploadUrl, objectKeyFromUrl } from "@/lib/storage/oss";
import { buildEpisodeObjectKey } from "@/lib/storage/oss-keys";
import type { renderRoughCut } from "@/trigger/render-rough-cut";

export async function POST(
  _request: Request,
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

  // 跟切片一样：触发的任务走 admin client（不受 RLS 保护），这里先用 RLS 受限的
  // client 确认这期确实是这个用户的
  const { data: episode } = await supabase
    .from("episodes")
    .select("audio_url, show_id")
    .eq("id", episodeId)
    .maybeSingle();
  if (!episode?.audio_url) {
    return NextResponse.json({ error: "找不到这期节目或音频" }, { status: 404 });
  }

  const { data: roughCut } = await supabase
    .from("rough_cuts")
    .select("id")
    .eq("episode_id", episodeId)
    .maybeSingle();
  if (!roughCut) {
    return NextResponse.json({ error: "还没有生成过粗剪建议，先生成建议再渲染" }, { status: 400 });
  }

  const downloadUrl = getSignedDownloadUrl(objectKeyFromUrl(episode.audio_url), 4 * 60 * 60);
  const objectKey = buildEpisodeObjectKey(episode.show_id, "roughcut.mp3");
  const uploadUrl = getSignedUploadUrl(objectKey, 4 * 60 * 60);

  await tasks.trigger<typeof renderRoughCut>("render-rough-cut", {
    episodeId,
    downloadUrl,
    objectKey,
    uploadUrl,
  });

  return NextResponse.json({ ok: true });
}
