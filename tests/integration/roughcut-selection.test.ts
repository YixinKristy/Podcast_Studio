// 粗剪建议的勾选状态持久化——纯 DB 读写，不碰 LLM，跟 material-versions.test.ts 一个套路。
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/database.types";
import { updateSelection, type StoredSuggestion } from "@/lib/services/roughcut/generate";

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
let episodeId: string;
let roughCutId: string;

const SEED_SUGGESTIONS: StoredSuggestion[] = [
  {
    id: "l1-0",
    layer: "L1",
    type: "filler",
    startSeconds: 3,
    endSeconds: 4,
    reason: "纯语气词",
    confidence: 0.9,
    selected: true,
  },
  {
    id: "l2-0",
    layer: "L2",
    type: "redundant",
    startSeconds: 10,
    endSeconds: 20,
    reason: "重复表达",
    confidence: 0.6,
    selected: false,
  },
];

beforeAll(async () => {
  const { data: user, error } = await admin.auth.admin.createUser({
    email: `roughcut-selection-${Date.now()}@example.com`,
    password: "test-password-123",
    email_confirm: true,
  });
  if (error || !user.user) throw error ?? new Error("failed to create user");
  userId = user.user.id;

  const { data: show, error: showErr } = await admin
    .from("shows")
    .insert({ user_id: userId, name: "粗剪测试节目" })
    .select("id")
    .single();
  if (showErr || !show) throw showErr ?? new Error("failed to create show");
  showId = show.id;

  const { data: episode, error: epErr } = await admin
    .from("episodes")
    .insert({ show_id: showId, source_type: "file", status: "generating" })
    .select("id")
    .single();
  if (epErr || !episode) throw epErr ?? new Error("failed to create episode");
  episodeId = episode.id;

  const { data: roughCut, error: rcErr } = await admin
    .from("rough_cuts")
    .insert({
      episode_id: episodeId,
      status: "ready",
      suggestions:
        SEED_SUGGESTIONS as unknown as Database["public"]["Tables"]["rough_cuts"]["Insert"]["suggestions"],
    })
    .select("id")
    .single();
  if (rcErr || !roughCut) throw rcErr ?? new Error("failed to create rough cut");
  roughCutId = roughCut.id;
});

afterAll(async () => {
  if (episodeId) await admin.from("episodes").delete().eq("id", episodeId);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

describe("updateSelection", () => {
  it("只把传入 id 对应的建议标成 selected，其它的取消勾选", async () => {
    await updateSelection(admin, episodeId, ["l2-0"]);

    const { data } = await admin
      .from("rough_cuts")
      .select("suggestions")
      .eq("id", roughCutId)
      .single();
    const suggestions = data?.suggestions as unknown as StoredSuggestion[];

    expect(suggestions.find((s) => s.id === "l1-0")?.selected).toBe(false);
    expect(suggestions.find((s) => s.id === "l2-0")?.selected).toBe(true);
  });

  it("传空数组等于全部取消勾选", async () => {
    await updateSelection(admin, episodeId, []);

    const { data } = await admin
      .from("rough_cuts")
      .select("suggestions")
      .eq("id", roughCutId)
      .single();
    const suggestions = data?.suggestions as unknown as StoredSuggestion[];

    expect(suggestions.every((s) => !s.selected)).toBe(true);
  });
});
