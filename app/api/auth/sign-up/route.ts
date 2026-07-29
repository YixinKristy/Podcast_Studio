import { NextResponse } from "next/server";
import { z } from "zod";
import { signUpWithPassword } from "@/lib/services/auth";
import { createClient } from "@/lib/db/supabase/server";

const bodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(6, "密码至少 6 位"),
});

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "输入不对" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const result = await signUpWithPassword(supabase, parsed.data.email, parsed.data.password);

  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
