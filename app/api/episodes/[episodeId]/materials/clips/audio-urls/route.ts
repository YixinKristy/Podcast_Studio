import { NextResponse } from "next/server";
import { createClient } from "@/lib/db/supabase/server";
import {
  getSignedDownloadUrl,
  getSignedDownloadUrlAsAttachment,
  objectKeyFromUrl,
} from "@/lib/storage/oss";
import { clipsStoredContentSchema } from "@/prompts/clips";

// bucket 私有，clips content 里存的是不带签名的地址（跟 episodes.audio_url 一个套路），
// 播放/下载时才按需现签。RLS 保证只有 owner 能查到这条 material。
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ episodeId: string }> },
) {
  const { episodeId } = await params;
  const supabase = await createClient();

  const { data: material } = await supabase
    .from("materials")
    .select("content")
    .eq("episode_id", episodeId)
    .eq("type", "clips")
    .maybeSingle();

  if (!material) {
    return NextResponse.json({ urls: [] });
  }

  const parsed = clipsStoredContentSchema.safeParse(material.content);
  if (!parsed.success) {
    return NextResponse.json({ urls: [] });
  }

  const urls = parsed.data.clips.map((clip) =>
    getSignedDownloadUrl(objectKeyFromUrl(clip.audioUrl), 6 * 60 * 60),
  );
  // 单独一份带 content-disposition: attachment 的 URL 给"下载"按钮用——播放器继续用
  // 上面那份不受影响
  const downloadUrls = parsed.data.clips.map((clip, i) =>
    getSignedDownloadUrlAsAttachment(
      objectKeyFromUrl(clip.audioUrl),
      `${clip.noteTitle || `clip-${i + 1}`}.mp3`,
      6 * 60 * 60,
    ),
  );
  return NextResponse.json({ urls, downloadUrls });
}
