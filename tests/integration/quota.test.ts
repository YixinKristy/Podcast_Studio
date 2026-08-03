// 额度扣减与冲正——docs/09 §五要求必测的项。
// 也覆盖了任务 1.7 踩过的一个真实 bug：用 RLS 受限的 client 写 quota_ledger 会被静默拒绝
// （见 docs/decisions/quota-write-client-bug.md），这里显式断言必须用 admin client。
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/database.types";
import {
  deductQuotaForGeneration,
  getUsedQuota,
  refundQuotaForFailure,
} from "@/lib/services/quota";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const email = `quota-test-${runId}@example.com`;
const password = "quota-test-password-!23";
const month = new Date().toISOString().slice(0, 7) + "-01";

let userId: string;
let showId: string;
let episodeId: string;
let userClient: SupabaseClient<Database>;

beforeAll(async () => {
  const { data: user, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (userErr || !user.user) throw userErr ?? new Error("failed to create user");
  userId = user.user.id;

  const { data: show, error: showErr } = await admin
    .from("shows")
    .insert({ user_id: userId, name: "额度测试节目" })
    .select("id")
    .single();
  if (showErr || !show) throw showErr ?? new Error("failed to create show");
  showId = show.id;

  const { data: episode, error: episodeErr } = await admin
    .from("episodes")
    .insert({ show_id: showId, source_type: "file", status: "uploaded" })
    .select("id")
    .single();
  if (episodeErr || !episode) throw episodeErr ?? new Error("failed to create episode");
  episodeId = episode.id;

  userClient = createClient<Database>(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: signInErr } = await userClient.auth.signInWithPassword({ email, password });
  if (signInErr) throw signInErr;
}, 30_000);

afterAll(async () => {
  await admin.from("quota_ledger").delete().eq("user_id", userId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("额度扣减/冲正", () => {
  it("用 RLS 受限的 client 扣额度会抛错，不能静默失败（回归测试）", async () => {
    await expect(
      deductQuotaForGeneration(userClient, userId, episodeId, randomUUID()),
    ).rejects.toThrow();
    expect(await getUsedQuota(admin, userId)).toBe(0);
  });

  it("用 admin client 扣额度成功，且能读到", async () => {
    const attemptId = randomUUID();
    const result = await deductQuotaForGeneration(admin, userId, episodeId, attemptId);
    expect(result.ok).toBe(true);
    expect(await getUsedQuota(admin, userId)).toBe(1);

    // 同一个 attemptId 重复调用不重复扣（幂等）
    await deductQuotaForGeneration(admin, userId, episodeId, attemptId);
    expect(await getUsedQuota(admin, userId)).toBe(1);
  });

  it("失败冲正后净额度归零，同一 attemptId 重复冲正不会多退", async () => {
    const attemptId = randomUUID();
    await deductQuotaForGeneration(admin, userId, episodeId, attemptId);
    const usedAfterDeduct = await getUsedQuota(admin, userId);

    await refundQuotaForFailure(admin, userId, episodeId, attemptId, "transcribe_failed");
    await refundQuotaForFailure(admin, userId, episodeId, attemptId, "transcribe_failed");

    expect(await getUsedQuota(admin, userId)).toBe(usedAfterDeduct - 1);
  });

  it("不同 attemptId 是独立的尝试，各自扣减", async () => {
    const before = await getUsedQuota(admin, userId);
    await deductQuotaForGeneration(admin, userId, episodeId, randomUUID());
    await deductQuotaForGeneration(admin, userId, episodeId, randomUUID());
    expect(await getUsedQuota(admin, userId)).toBe(before + 2);
  });

  it("用完月度额度后拒绝再扣", async () => {
    await admin.from("quota_ledger").delete().eq("user_id", userId).eq("month", month);
    for (let i = 0; i < 4; i++) {
      await deductQuotaForGeneration(admin, userId, episodeId, randomUUID());
    }
    expect(await getUsedQuota(admin, userId)).toBe(4);

    const result = await deductQuotaForGeneration(admin, userId, episodeId, randomUUID());
    expect(result).toEqual({ ok: false, reason: "insufficient_quota" });
    expect(await getUsedQuota(admin, userId)).toBe(4);
  });
});
