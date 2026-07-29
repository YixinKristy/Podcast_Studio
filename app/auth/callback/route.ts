import { NextResponse } from "next/server";
import { createClient } from "@/lib/db/supabase/server";
import { createAdminClient } from "@/lib/db/supabase/admin";

// 魔法链接点回来落地的地方：换 session，清掉这个邮箱的验证码限流计数，跳去目标页
// （没建节目的话，middleware 的 A6 逻辑会再把它拦到 /onboarding）
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/new";

  if (!code) {
    return NextResponse.redirect(`${origin}/?error=auth_missing_code`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/?error=auth_callback_failed`);
  }

  const admin = createAdminClient();
  await admin.from("auth_email_challenges").delete().eq("email", data.user.email!);

  return NextResponse.redirect(`${origin}${next}`);
}
