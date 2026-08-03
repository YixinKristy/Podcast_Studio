import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/db/supabase/server";
import { generateMaterial } from "@/lib/services/materials/generate";
import {
  TEXT_MATERIAL_DEFINITIONS,
  isTextMaterialType,
} from "@/lib/services/materials/definitions";
import type { MaterialDefinition } from "@/lib/services/materials/types";

const bodySchema = z.object({ instruction: z.string().optional() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ episodeId: string; type: string }> },
) {
  const { episodeId, type } = await params;
  if (!isTextMaterialType(type)) {
    return NextResponse.json({ error: "不支持的物料类型" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  const instruction = parsed.success ? parsed.data.instruction : undefined;

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
