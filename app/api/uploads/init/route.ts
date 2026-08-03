import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/db/supabase/server";
import { getOwnShow } from "@/lib/services/show";
import { initUpload, MAX_FILE_SIZE } from "@/lib/services/upload";

const bodySchema = z.object({
  contentHash: z.string().min(1),
  fileName: z.string().min(1),
  fileSize: z.number().int().positive().max(MAX_FILE_SIZE),
  mimeType: z.string(),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不对" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: show } = await getOwnShow(supabase);
  if (!show) {
    return NextResponse.json({ error: "还没建节目" }, { status: 400 });
  }

  const result = await initUpload(supabase, { showId: show.id, ...parsed.data });
  return NextResponse.json(result);
}
