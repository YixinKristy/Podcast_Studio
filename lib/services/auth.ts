import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/db/supabase/admin";
import type { Database } from "@/lib/db/database.types";

const RESEND_COOLDOWN_SECONDS = 60;
const HINT_DIFFERENT_EMAIL_AFTER = 3;
const LOCK_AFTER_ATTEMPTS = 5;
const LOCK_MINUTES = 10;
// 超过这么久没再试，就当是一次新的会话，计数器清零
const WINDOW_RESET_MINUTES = 30;

export type RequestEmailLoginResult =
  | { ok: true; hintSwitchEmail: boolean }
  | { ok: false; reason: "cooldown" | "locked"; retryAfterSeconds: number }
  | { ok: false; reason: "send_failed"; message: string };

// docs/07 A1（60s 重发冷却 + 连续 3 次提示换邮箱）+ A2（5 次锁 10 分钟）。
// 这里用同一个计数器覆盖两条规则的原因：魔法链接场景没有"验证码输错"这个动作，
// 能触发限流的只有"重复请求发信"，所以把 A1/A2 都落到同一个「发送次数」计数上。
// supabase 必须是 @supabase/ssr 的 server client（绑定了当前请求的 cookies），
// 不能用一次性的裸客户端 —— PKCE 流程要把 code verifier 写进 cookie，
// 不然邮件链接点回来时 /auth/callback 换不出 session（实测踩过这个坑）。
export async function requestEmailLogin(
  supabase: SupabaseClient<Database>,
  email: string,
  emailRedirectTo: string,
): Promise<RequestEmailLoginResult> {
  const admin = createAdminClient();
  const now = new Date();

  const { data: existing } = await admin
    .from("auth_email_challenges")
    .select("*")
    .eq("email", email)
    .maybeSingle();

  if (existing?.locked_until && new Date(existing.locked_until) > now) {
    return {
      ok: false,
      reason: "locked",
      retryAfterSeconds: secondsUntil(existing.locked_until),
    };
  }

  if (existing?.last_sent_at) {
    const secondsSinceLastSend = (now.getTime() - new Date(existing.last_sent_at).getTime()) / 1000;
    if (secondsSinceLastSend < RESEND_COOLDOWN_SECONDS) {
      return {
        ok: false,
        reason: "cooldown",
        retryAfterSeconds: Math.ceil(RESEND_COOLDOWN_SECONDS - secondsSinceLastSend),
      };
    }
  }

  const windowExpired =
    !existing?.window_started_at ||
    now.getTime() - new Date(existing.window_started_at).getTime() >
      WINDOW_RESET_MINUTES * 60 * 1000;

  const nextAttemptCount = windowExpired ? 1 : (existing?.attempt_count ?? 0) + 1;
  const windowStartedAt = windowExpired
    ? now.toISOString()
    : (existing?.window_started_at ?? now.toISOString());

  if (nextAttemptCount > LOCK_AFTER_ATTEMPTS) {
    const lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60 * 1000).toISOString();
    await admin.from("auth_email_challenges").upsert({
      email,
      attempt_count: nextAttemptCount,
      window_started_at: windowStartedAt,
      locked_until: lockedUntil,
    });
    return { ok: false, reason: "locked", retryAfterSeconds: LOCK_MINUTES * 60 };
  }

  const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo } });

  if (error) {
    return { ok: false, reason: "send_failed", message: error.message };
  }

  await admin.from("auth_email_challenges").upsert({
    email,
    attempt_count: nextAttemptCount,
    window_started_at: windowStartedAt,
    last_sent_at: now.toISOString(),
    locked_until: null,
  });

  return { ok: true, hintSwitchEmail: nextAttemptCount >= HINT_DIFFERENT_EMAIL_AFTER };
}

function secondsUntil(isoDate: string): number {
  return Math.max(0, Math.ceil((new Date(isoDate).getTime() - Date.now()) / 1000));
}
