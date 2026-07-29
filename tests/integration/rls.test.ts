// 越权测试：验证 RLS 策略下，用户读写不到别人的数据。
// 需要真实 Supabase 项目的凭证（本地读 .env.local，CI 读 repo secrets）。
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/database.types";

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
const userAEmail = `rls-test-a-${runId}@example.com`;
const userBEmail = `rls-test-b-${runId}@example.com`;
const password = "rls-test-password-!23";

let userAId: string;
let userBId: string;
let showAId: string;
let episodeAId: string;
let clientA: SupabaseClient<Database>;
let clientB: SupabaseClient<Database>;

async function signIn(email: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

beforeAll(async () => {
  const { data: userA, error: userAErr } = await admin.auth.admin.createUser({
    email: userAEmail,
    password,
    email_confirm: true,
  });
  if (userAErr || !userA.user) throw userAErr ?? new Error("failed to create user A");
  userAId = userA.user.id;

  const { data: userB, error: userBErr } = await admin.auth.admin.createUser({
    email: userBEmail,
    password,
    email_confirm: true,
  });
  if (userBErr || !userB.user) throw userBErr ?? new Error("failed to create user B");
  userBId = userB.user.id;

  clientA = await signIn(userAEmail);
  clientB = await signIn(userBEmail);

  const { data: show, error: showErr } = await admin
    .from("shows")
    .insert({ user_id: userAId, name: "A 的节目" })
    .select("id")
    .single();
  if (showErr || !show) throw showErr ?? new Error("failed to create show");
  showAId = show.id;

  const { data: episode, error: episodeErr } = await admin
    .from("episodes")
    .insert({ show_id: showAId, source_type: "file", status: "ready" })
    .select("id")
    .single();
  if (episodeErr || !episode) throw episodeErr ?? new Error("failed to create episode");
  episodeAId = episode.id;

  await admin
    .from("materials")
    .insert({ episode_id: episodeAId, type: "title", content: { text: "A 的标题" } });
  await admin.from("quota_ledger").insert({
    user_id: userAId,
    month: "2026-07-01",
    delta: 1,
    episode_id: episodeAId,
    reason: "generate_start",
  });
}, 30_000);

afterAll(async () => {
  if (userAId) await admin.auth.admin.deleteUser(userAId);
  if (userBId) await admin.auth.admin.deleteUser(userBId);
});

describe("RLS：跨用户越权", () => {
  it("owner 能读到自己的 show/episode/material/quota_ledger", async () => {
    const { data: shows } = await clientA.from("shows").select("id").eq("id", showAId);
    expect(shows).toHaveLength(1);

    const { data: episodes } = await clientA.from("episodes").select("id").eq("id", episodeAId);
    expect(episodes).toHaveLength(1);

    const { data: materials } = await clientA
      .from("materials")
      .select("id")
      .eq("episode_id", episodeAId);
    expect(materials).toHaveLength(1);

    const { data: ledger } = await clientA
      .from("quota_ledger")
      .select("id")
      .eq("episode_id", episodeAId);
    expect(ledger).toHaveLength(1);
  });

  it("非 owner 读不到别人的 show/episode/material/quota_ledger", async () => {
    const { data: shows } = await clientB.from("shows").select("id").eq("id", showAId);
    expect(shows).toEqual([]);

    const { data: episodes } = await clientB.from("episodes").select("id").eq("id", episodeAId);
    expect(episodes).toEqual([]);

    const { data: materials } = await clientB
      .from("materials")
      .select("id")
      .eq("episode_id", episodeAId);
    expect(materials).toEqual([]);

    const { data: ledger } = await clientB
      .from("quota_ledger")
      .select("id")
      .eq("episode_id", episodeAId);
    expect(ledger).toEqual([]);
  });

  it("非 owner 更新不了别人的 show（RLS 过滤掉这一行，0 行受影响）", async () => {
    const { data } = await clientB
      .from("shows")
      .update({ name: "改掉你的节目名" })
      .eq("id", showAId)
      .select("id");
    expect(data).toEqual([]);

    const { data: stillOriginal } = await admin
      .from("shows")
      .select("name")
      .eq("id", showAId)
      .single();
    expect(stillOriginal?.name).toBe("A 的节目");
  });

  it("owner 自己也不能直接写 quota_ledger（只有 service role 能写）", async () => {
    const { error } = await clientA.from("quota_ledger").insert({
      user_id: userAId,
      month: "2026-07-01",
      delta: 1,
      episode_id: episodeAId,
      reason: "manual_hack",
    });
    expect(error).not.toBeNull();
  });
});
