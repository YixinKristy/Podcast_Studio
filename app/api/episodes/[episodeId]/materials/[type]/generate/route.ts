import { NextResponse } from "next/server";
import { z } from "zod";
import { tasks } from "@trigger.dev/sdk";
import { createClient } from "@/lib/db/supabase/server";
import { generateMaterial } from "@/lib/services/materials/generate";
import {
  TEXT_MATERIAL_DEFINITIONS,
  isTextMaterialType,
} from "@/lib/services/materials/definitions";
import type { MaterialDefinition } from "@/lib/services/materials/types";
import type { generateClips } from "@/trigger/generate-clips";
import { getSignedDownloadUrl, objectKeyFromUrl } from "@/lib/storage/oss";
import { buildClipUploadSlots } from "@/lib/services/clips/upload-slots";

const bodySchema = z.object({ instruction: z.string().optional() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ episodeId: string; type: string }> },
) {
  const { episodeId, type } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  const instruction = parsed.success ? parsed.data.instruction : undefined;

  // 切片要跑确定性预筛 + ffmpeg 真实切音频，扛不住塞进这个请求里同步跑完，
  // 走 Trigger.dev 任务，立刻返回，前端跟文本物料一样靠轮询状态拿结果
  if (type === "clips") {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }
    // 触发的是走 admin client 的 Trigger.dev 任务（不受 RLS 保护），这里先用
    // RLS 受限的 client 确认这期确实是这个用户的，不然谁都能拿别人的 episodeId 触发生成
    const { data: episode } = await supabase
      .from("episodes")
      .select("audio_url, show_id")
      .eq("id", episodeId)
      .maybeSingle();
    if (!episode?.audio_url) {
      return NextResponse.json({ error: "找不到这期节目或音频" }, { status: 404 });
    }
    const downloadUrl = getSignedDownloadUrl(objectKeyFromUrl(episode.audio_url), 4 * 60 * 60);
    const uploadSlots = buildClipUploadSlots(episode.show_id);
    await tasks.trigger<typeof generateClips>("generate-clips", {
      episodeId,
      instruction,
      downloadUrl,
      uploadSlots,
    });
    return NextResponse.json({ ok: true });
  }

  if (!isTextMaterialType(type)) {
    return NextResponse.json({ error: "不支持的物料类型" }, { status: 400 });
  }

  const supabase = await createClient();
  try {
    const content = await generateMaterial(
      supabase,
      episodeId,
      TEXT_MATERIAL_DEFINITIONS[type] as MaterialDefinition<unknown>,
      instruction,
    );
    return NextResponse.json({ ok: true, content });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "生成失败" },
      { status: 500 },
    );
  }
}
