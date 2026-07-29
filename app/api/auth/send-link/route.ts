import { NextResponse } from "next/server";
import { z } from "zod";
import { requestEmailLogin } from "@/lib/services/auth";
import { createClient } from "@/lib/db/supabase/server";

const bodySchema = z.object({
  email: z.string().email(),
  next: z.string().optional(),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "邮箱格式不对，再检查一下" }, { status: 400 });
  }

  const { email, next } = parsed.data;
  const origin = new URL(request.url).origin;
  const redirectTo = `${origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}`;

  const supabase = await createClient();
  const result = await requestEmailLogin(supabase, email, redirectTo);

  if (result.ok) {
    return NextResponse.json({ ok: true, hintSwitchEmail: result.hintSwitchEmail });
  }

  if (result.reason === "cooldown") {
    return NextResponse.json(
      { error: "发太快了，等倒计时结束再试", retryAfterSeconds: result.retryAfterSeconds },
      { status: 429 },
    );
  }

  if (result.reason === "locked") {
    return NextResponse.json(
      {
        error: "请求太频繁，锁定 10 分钟，请稍后再试",
        retryAfterSeconds: result.retryAfterSeconds,
      },
      { status: 429 },
    );
  }

  return NextResponse.json({ error: "发送失败，稍后再试" }, { status: 500 });
}
