import { NextResponse } from "next/server";
import { createClient } from "@/lib/db/supabase/server";
import { uploadPart, UploadSessionError } from "@/lib/services/upload";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ sessionId: string; partNo: string }> },
) {
  const { sessionId, partNo } = await params;
  const partNoNum = Number(partNo);
  if (!Number.isInteger(partNoNum) || partNoNum < 1) {
    return NextResponse.json({ error: "分片序号不对" }, { status: 400 });
  }

  const arrayBuffer = await request.arrayBuffer();
  if (arrayBuffer.byteLength === 0) {
    return NextResponse.json({ error: "分片内容是空的" }, { status: 400 });
  }

  const supabase = await createClient();
  try {
    await uploadPart(supabase, sessionId, partNoNum, Buffer.from(arrayBuffer));
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UploadSessionError) {
      return NextResponse.json({ error: err.message }, { status: 410 });
    }
    return NextResponse.json({ error: "分片上传失败，重试一下" }, { status: 500 });
  }
}
