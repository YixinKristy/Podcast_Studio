import { NextResponse } from "next/server";
import { z } from "zod";
import { signInWithPassword } from "@/lib/services/auth";
import { createClient } from "@/lib/db/supabase/server";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "邮箱格式不对" }, { status: 400 });
  }

  const supabase = await createClient();
  const result = await signInWithPassword(supabase, parsed.data.email, parsed.data.password);

  if (result.ok) {
    return NextResponse.json({ ok: true });
  }

  if (result.reason === "locked") {
    return NextResponse.json(
      { error: "密码错误次数太多，锁定 10 分钟", retryAfterSeconds: result.retryAfterSeconds },
      { status: 429 },
    );
  }

  if (result.reason === "invalid_credentials") {
    return NextResponse.json({ error: "邮箱或密码不对，再试试" }, { status: 401 });
  }

  return NextResponse.json({ error: "登录失败，稍后再试" }, { status: 500 });
}
