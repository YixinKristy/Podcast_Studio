import { NextResponse } from "next/server";
import { createClient } from "@/lib/db/supabase/server";
import { getOrCreateMaterial, saveNewVersion } from "@/lib/services/materials/store";
import {
  TEXT_MATERIAL_DEFINITIONS,
  isTextMaterialType,
} from "@/lib/services/materials/definitions";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ episodeId: string; type: string }> },
) {
  const { episodeId, type } = await params;
  if (!isTextMaterialType(type)) {
    return NextResponse.json({ error: "不支持的物料类型" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = TEXT_MATERIAL_DEFINITIONS[type].schema.safeParse(body?.content);
  if (!parsed.success) {
    return NextResponse.json({ error: "内容格式不对" }, { status: 400 });
  }

  const supabase = await createClient();
  const materialId = await getOrCreateMaterial(supabase, episodeId, type);
  await saveNewVersion(supabase, materialId, parsed.data, "edited");
  return NextResponse.json({ ok: true });
}
