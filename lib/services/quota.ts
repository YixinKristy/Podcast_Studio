import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";

export const MONTHLY_QUOTA_LIMIT = 4;

function firstOfMonth(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

export async function getUsedQuota(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<number> {
  const { data } = await supabase
    .from("quota_ledger")
    .select("delta")
    .eq("user_id", userId)
    .eq("month", firstOfMonth());
  return (data ?? []).reduce((sum, row) => sum + row.delta, 0);
}

export type DeductResult = { ok: true } | { ok: false; reason: "insufficient_quota" };

// 注意：quota_ledger 的 RLS 只给 owner 开了 SELECT，没有 INSERT 策略（见迁移文件注释：
// "客户端不能直接写这张表，只能读自己的；扣减/冲正只能由服务端用 service role 写"）。
// 这两个函数的 supabase 参数必须传 lib/db/supabase/admin.ts 的 service role client，
// 传一个 RLS 受限的 client 会导致 upsert 被 RLS 静默拒绝、额度实际没扣——这个坑已经踩过一次，
// 见 docs/decisions/quota-write-client-bug.md。
//
// 幂等键是 (episode_id, reason)，reason 里带 attemptId——同一次尝试重复调用不会重复扣，
// 但重试（失败冲正后再点一次「开始生成」）是新的 attemptId，会正常再扣一次。
// 这次尝试是否真正扣额度由调用方在事务性的"状态迁移"里把关（见 app/api/episodes/[id]/start），
// 不是靠这个函数本身防重复调用。
export async function deductQuotaForGeneration(
  supabase: SupabaseClient<Database>,
  userId: string,
  episodeId: string,
  attemptId: string,
): Promise<DeductResult> {
  const used = await getUsedQuota(supabase, userId);
  if (used >= MONTHLY_QUOTA_LIMIT) {
    return { ok: false, reason: "insufficient_quota" };
  }

  const { error } = await supabase.from("quota_ledger").upsert(
    {
      user_id: userId,
      month: firstOfMonth(),
      delta: 1,
      episode_id: episodeId,
      reason: `generate_start:${attemptId}`,
    },
    { onConflict: "episode_id,reason", ignoreDuplicates: true },
  );
  if (error) {
    throw new Error(`扣额度失败: ${error.message}`);
  }

  return { ok: true };
}

// D1/D4：转写失败或识别不到人声，冲正额度，不算这次用户的份额。
// 用同一个 attemptId 配对扣减记录，保证一次尝试最多冲正一次。
export async function refundQuotaForFailure(
  supabase: SupabaseClient<Database>,
  userId: string,
  episodeId: string,
  attemptId: string,
  reason: "transcribe_failed" | "no_voice",
): Promise<void> {
  const { error } = await supabase.from("quota_ledger").upsert(
    {
      user_id: userId,
      month: firstOfMonth(),
      delta: -1,
      episode_id: episodeId,
      reason: `${reason}_refund:${attemptId}`,
    },
    { onConflict: "episode_id,reason", ignoreDuplicates: true },
  );
  if (error) {
    throw new Error(`冲正额度失败: ${error.message}`);
  }
}
