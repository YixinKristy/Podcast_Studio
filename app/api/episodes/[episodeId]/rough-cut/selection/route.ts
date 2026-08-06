import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/db/supabase/server";
import { updateSelection } from "@/lib/services/roughcut/generate";

const bodySchema = z.object({ selectedIds: z.array(z.string()) });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ episodeId: string }> },
) {
  const { episodeId } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不对" }, { status: 400 });
  }

  const supabase = await createClient();
  try {
    await updateSelection(supabase, episodeId, parsed.data.selectedIds);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "保存失败" },
      { status: 500 },
    );
  }
}
