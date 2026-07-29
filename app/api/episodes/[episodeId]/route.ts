import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/db/supabase/server";
import { updateEpisodeInfo } from "@/lib/services/episode";

const bodySchema = z.object({
  promoteNote: z.string().optional(),
  guests: z.array(z.object({ name: z.string(), role: z.string().optional() })).optional(),
  generateMaterials: z.array(z.string()).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ episodeId: string }> },
) {
  const { episodeId } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不对" }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await updateEpisodeInfo(supabase, episodeId, parsed.data);

  if (error) {
    return NextResponse.json({ error: "保存失败" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
