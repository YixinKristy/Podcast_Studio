import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/db/supabase/server";
import {
  getPartUploadUrl,
  recordUploadedPart,
  uploadPart,
  UploadSessionError,
} from "@/lib/services/upload";

const recordBodySchema = z.object({
  etag: z.string().min(1),
});

function parsePartNo(partNo: string): number | null {
  const partNoNum = Number(partNo);
  return Number.isInteger(partNoNum) && partNoNum >= 1 ? partNoNum : null;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string; partNo: string }> },
) {
  const { sessionId, partNo } = await params;
  const partNoNum = parsePartNo(partNo);
  if (!partNoNum) {
    return NextResponse.json({ error: "分片序号不对" }, { status: 400 });
  }

  const supabase = await createClient();
  try {
    const uploadUrl = await getPartUploadUrl(supabase, sessionId, partNoNum);
    return NextResponse.json({ uploadUrl });
  } catch (err) {
    if (err instanceof UploadSessionError) {
      return NextResponse.json({ error: err.message }, { status: 410 });
    }
    return NextResponse.json({ error: "创建上传链接失败" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ sessionId: string; partNo: string }> },
) {
  const { sessionId, partNo } = await params;
  const partNoNum = parsePartNo(partNo);
  if (!partNoNum) {
    return NextResponse.json({ error: "分片序号不对" }, { status: 400 });
  }

  const parsed = recordBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "参数不对" }, { status: 400 });
  }

  const supabase = await createClient();
  try {
    await recordUploadedPart(supabase, sessionId, partNoNum, parsed.data.etag);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UploadSessionError) {
      return NextResponse.json({ error: err.message }, { status: 410 });
    }
    return NextResponse.json({ error: "记录分片失败" }, { status: 500 });
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ sessionId: string; partNo: string }> },
) {
  const { sessionId, partNo } = await params;
  const partNoNum = parsePartNo(partNo);
  if (!partNoNum) {
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
