import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/db/supabase/admin";
import type { Database } from "@/lib/db/database.types";

const LOCK_AFTER_ATTEMPTS = 5;
const LOCK_MINUTES = 10;
// 超过这么久没再试，就当是一次新的会话，计数器清零
const WINDOW_RESET_MINUTES = 30;

export type SignUpResult = { ok: true } | { ok: false; message: string };

export async function signUpWithPassword(
  supabase: SupabaseClient<Database>,
  email: string,
  password: string,
): Promise<SignUpResult> {
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) {
    return {
      ok: false,
      message:
        error.message === "User already registered" ? "这个邮箱已经注册过了" : "注册失败，稍后再试",
    };
  }
  return { ok: true };
}

export type SignInResult =
  | { ok: true }
  | { ok: false; reason: "locked"; retryAfterSeconds: number }
  | { ok: false; reason: "invalid_credentials" }
  | { ok: false; reason: "failed"; message: string };

// docs/07 A2：密码连续输错 5 次锁 10 分钟，防爆破。
export async function signInWithPassword(
  supabase: SupabaseClient<Database>,
  email: string,
  password: string,
): Promise<SignInResult> {
  const admin = createAdminClient();
  const now = new Date();

  const { data: existing } = await admin
    .from("auth_login_attempts")
    .select("*")
    .eq("email", email)
    .maybeSingle();

  if (existing?.locked_until && new Date(existing.locked_until) > now) {
    return { ok: false, reason: "locked", retryAfterSeconds: secondsUntil(existing.locked_until) };
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (!error) {
    // 登录成功，清空失败计数
    if (existing) {
      await admin.from("auth_login_attempts").delete().eq("email", email);
    }
    return { ok: true };
  }

  if (error.message !== "Invalid login credentials") {
    return { ok: false, reason: "failed", message: error.message };
  }

  const windowExpired =
    !existing?.window_started_at ||
    now.getTime() - new Date(existing.window_started_at).getTime() >
      WINDOW_RESET_MINUTES * 60 * 1000;

  const nextAttemptCount = windowExpired ? 1 : (existing?.attempt_count ?? 0) + 1;
  const windowStartedAt = windowExpired
    ? now.toISOString()
    : (existing?.window_started_at ?? now.toISOString());

  if (nextAttemptCount >= LOCK_AFTER_ATTEMPTS) {
    const lockedUntil = new Date(now.getTime() + LOCK_MINUTES * 60 * 1000).toISOString();
    await admin.from("auth_login_attempts").upsert({
      email,
      attempt_count: nextAttemptCount,
      window_started_at: windowStartedAt,
      last_attempt_at: now.toISOString(),
      locked_until: lockedUntil,
    });
    return { ok: false, reason: "locked", retryAfterSeconds: LOCK_MINUTES * 60 };
  }

  await admin.from("auth_login_attempts").upsert({
    email,
    attempt_count: nextAttemptCount,
    window_started_at: windowStartedAt,
    last_attempt_at: now.toISOString(),
    locked_until: null,
  });

  return { ok: false, reason: "invalid_credentials" };
}

function secondsUntil(isoDate: string): number {
  return Math.max(0, Math.ceil((new Date(isoDate).getTime() - Date.now()) / 1000));
}
