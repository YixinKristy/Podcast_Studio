import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/db/supabase/server";
import { generateRoughCutSuggestions } from "@/lib/services/roughcut/generate";

const bodySchema = z.object({ instruction: z.string().optional() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ episodeId: string }> },
) {
  const { episodeId } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  const instruction = parsed.success ? parsed.data.instruction : undefined;

  const supabase = await createClient();
  try {
    const result = await generateRoughCutSuggestions(supabase, episodeId, instruction);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "生成失败" },
      { status: 500 },
    );
  }
}
