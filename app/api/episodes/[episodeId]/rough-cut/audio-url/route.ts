import { NextResponse } from "next/server";
import { createClient } from "@/lib/db/supabase/server";
import {
  getSignedDownloadUrl,
  getSignedDownloadUrlAsAttachment,
  objectKeyFromUrl,
} from "@/lib/storage/oss";

// bucket 私有，rough_cuts.audio_url 存的是不带签名的地址，播放/下载时才按需现签。
// RLS 保证只有 owner 能查到这条记录。
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ episodeId: string }> },
) {
  const { episodeId } = await params;
  const supabase = await createClient();

  const { data: roughCut } = await supabase
    .from("rough_cuts")
    .select("audio_url")
    .eq("episode_id", episodeId)
    .maybeSingle();

  if (!roughCut?.audio_url) {
    return NextResponse.json({ error: "还没有粗剪音频" }, { status: 404 });
  }

  const objectKey = objectKeyFromUrl(roughCut.audio_url);
  const url = getSignedDownloadUrl(objectKey, 6 * 60 * 60);
  // 单独一份带 content-disposition: attachment 的 URL 给下载链接用，播放器继续用上面那份
  const downloadUrl = getSignedDownloadUrlAsAttachment(objectKey, "粗剪音频.mp3", 6 * 60 * 60);
  return NextResponse.json({ url, downloadUrl });
}
