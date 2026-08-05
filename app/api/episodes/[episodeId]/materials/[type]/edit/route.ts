import { NextResponse } from "next/server";
import { createClient } from "@/lib/db/supabase/server";
import { getOrCreateMaterial, saveNewVersion } from "@/lib/services/materials/store";
import {
  TEXT_MATERIAL_DEFINITIONS,
  isGeneratableMaterialType,
  isTextMaterialType,
} from "@/lib/services/materials/definitions";
import { clipsStoredContentSchema } from "@/prompts/clips";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ episodeId: string; type: string }> },
) {
  const { episodeId, type } = await params;
  if (!isGeneratableMaterialType(type)) {
    return NextResponse.json({ error: "不支持的物料类型" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const schema = isTextMaterialType(type)
    ? TEXT_MATERIAL_DEFINITIONS[type].schema
    : clipsStoredContentSchema;
  const parsed = schema.safeParse(body?.content);
  if (!parsed.success) {
    return NextResponse.json({ error: "内容格式不对" }, { status: 400 });
  }

  const supabase = await createClient();
  const materialId = await getOrCreateMaterial(supabase, episodeId, type);
  await saveNewVersion(supabase, materialId, parsed.data, "edited");
  return NextResponse.json({ ok: true });
}
