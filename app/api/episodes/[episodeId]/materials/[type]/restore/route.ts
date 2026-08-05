import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/db/supabase/server";
import { getOrCreateMaterial, restoreVersion } from "@/lib/services/materials/store";
import { isGeneratableMaterialType } from "@/lib/services/materials/definitions";

const bodySchema = z.object({ version: z.number().int().positive() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ episodeId: string; type: string }> },
) {
  const { episodeId, type } = await params;
  if (!isGeneratableMaterialType(type)) {
    return NextResponse.json({ error: "不支持的物料类型" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不对" }, { status: 400 });
  }

  const supabase = await createClient();
  const materialId = await getOrCreateMaterial(supabase, episodeId, type);
  try {
    const result = await restoreVersion(supabase, materialId, parsed.data.version);
    return NextResponse.json({ ok: true, version: result.version });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "回退失败" },
      { status: 500 },
    );
  }
}
