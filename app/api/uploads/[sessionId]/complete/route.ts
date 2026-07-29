import { NextResponse } from "next/server";
import { tasks } from "@trigger.dev/sdk";
import { createClient } from "@/lib/db/supabase/server";
import { getOwnShow } from "@/lib/services/show";
import { completeUpload, UploadSessionError } from "@/lib/services/upload";
import { getSignedDownloadUrl, getSignedUploadUrl } from "@/lib/storage/oss";
import type { validateUpload } from "@/trigger/validate-upload";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  const supabase = await createClient();
  const { data: show } = await getOwnShow(supabase);
  if (!show) {
    return NextResponse.json({ error: "还没建节目" }, { status: 400 });
  }

  try {
    const result = await completeUpload(supabase, { sessionId, showId: show.id });

    // C2/C10：损坏探测 + 视频轨抽音频，异步做，不卡上传完成的响应。
    // trigger 任务不能直接用 ali-oss（见 trigger/validate-upload.ts 顶部注释），传签名 URL 进去。
    const extractedKey = result.objectKey.replace(/\.[^./]+$/, "") + ".audio-extracted.m4a";
    await tasks.trigger<typeof validateUpload>("validate-upload", {
      episodeId: result.episodeId,
      downloadUrl: getSignedDownloadUrl(result.objectKey),
      extractedUploadUrl: getSignedUploadUrl(extractedKey),
      extractedObjectKey: extractedKey,
    });
    return NextResponse.json({ episodeId: result.episodeId });
  } catch (err) {
    if (err instanceof UploadSessionError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    return NextResponse.json({ error: "完成上传失败" }, { status: 500 });
  }
}
