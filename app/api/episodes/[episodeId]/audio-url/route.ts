import { NextResponse } from "next/server";
import { createClient } from "@/lib/db/supabase/server";
import { getSignedDownloadUrl, objectKeyFromUrl } from "@/lib/storage/oss";

// bucket 是私有的，episodes.audio_url 存的是不带签名的地址，前端播放器直接用会被拒绝。
// 这个接口按需签一个短期有效的下载链接，RLS 保证只有 owner 能拿到。
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ episodeId: string }> },
) {
  const { episodeId } = await params;
  const supabase = await createClient();

  const { data: episode } = await supabase
    .from("episodes")
    .select("audio_url")
    .eq("id", episodeId)
    .single();

  if (!episode?.audio_url) {
    return NextResponse.json({ error: "找不到音频" }, { status: 404 });
  }

  const objectKey = objectKeyFromUrl(episode.audio_url);
  const url = getSignedDownloadUrl(objectKey, 6 * 60 * 60);
  return NextResponse.json({ url });
}
