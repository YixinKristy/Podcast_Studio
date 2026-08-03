// 状态机流转——docs/09 §五要求必测的项。
// 重点测 beginTranscription 的并发防重：两个并发请求只有一个能把状态改成 transcribing，
// 这是防止双击「开始生成」触发两次转写任务、扣两次额度的关键把关点。
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/database.types";
import { beginTranscription } from "@/lib/services/episode";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value;
}

const admin = createClient<Database>(
  requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { autoRefreshToken: false, persistSession: false } },
);

let showId: string;
let userId: string;
const createdEpisodeIds: string[] = [];

beforeEach(async () => {
  if (!userId) {
    const { data: user, error } = await admin.auth.admin.createUser({
      email: `episode-transition-${Date.now()}@example.com`,
      password: "test-password-123",
      email_confirm: true,
    });
    if (error || !user.user) throw error ?? new Error("failed to create user");
    userId = user.user.id;
    const { data: show, error: showErr } = await admin
      .from("shows")
      .insert({ user_id: userId, name: "状态机测试节目" })
      .select("id")
      .single();
    if (showErr || !show) throw showErr ?? new Error("failed to create show");
    showId = show.id;
  }
});

afterAll(async () => {
  if (createdEpisodeIds.length > 0) {
    await admin.from("episodes").delete().in("id", createdEpisodeIds);
  }
  if (userId) await admin.auth.admin.deleteUser(userId);
});

async function createEpisode(status: Database["public"]["Enums"]["episode_status"]) {
  const { data, error } = await admin
    .from("episodes")
    .insert({ show_id: showId, source_type: "file", status })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("failed to create episode");
  createdEpisodeIds.push(data.id);
  return data.id;
}

describe("beginTranscription 状态迁移", () => {
  it("uploaded -> transcribing 成功", async () => {
    const id = await createEpisode("uploaded");
    const { data, error } = await beginTranscription(admin, id);
    expect(error).toBeNull();
    expect(data?.id).toBe(id);
    const { data: ep } = await admin.from("episodes").select("status").eq("id", id).single();
    expect(ep?.status).toBe("transcribing");
  });

  it("transcribe_failed -> transcribing 成功（重试路径）", async () => {
    const id = await createEpisode("transcribe_failed");
    const { data } = await beginTranscription(admin, id);
    expect(data?.id).toBe(id);
  });

  it("已经在 generating/ready 的不能再迁移", async () => {
    const id = await createEpisode("generating");
    const { data } = await beginTranscription(admin, id);
    expect(data).toBeNull();
    const { data: ep } = await admin.from("episodes").select("status").eq("id", id).single();
    expect(ep?.status).toBe("generating");
  });

  it("并发双击：两个同时发起的迁移只有一个成功", async () => {
    const id = await createEpisode("uploaded");
    const [r1, r2] = await Promise.all([
      beginTranscription(admin, id),
      beginTranscription(admin, id),
    ]);
    const succeeded = [r1, r2].filter((r) => r.data !== null);
    expect(succeeded).toHaveLength(1);
  });
});
