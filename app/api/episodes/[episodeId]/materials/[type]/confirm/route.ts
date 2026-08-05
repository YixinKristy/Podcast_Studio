import { NextResponse } from "next/server";
import { createClient } from "@/lib/db/supabase/server";
import { confirmMaterial, getOrCreateMaterial } from "@/lib/services/materials/store";
import { isGeneratableMaterialType } from "@/lib/services/materials/definitions";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ episodeId: string; type: string }> },
) {
  const { episodeId, type } = await params;
  if (!isGeneratableMaterialType(type)) {
    return NextResponse.json({ error: "不支持的物料类型" }, { status: 400 });
  }

  const supabase = await createClient();
  const materialId = await getOrCreateMaterial(supabase, episodeId, type);
  await confirmMaterial(supabase, materialId);
  return NextResponse.json({ ok: true });
}
