// 状态机流转——docs/07 状态机文档：generating「逐项完成逐项 ready」→ ready。
// 这条迁移之前完全没写过，episode 会永远卡在 generating，测试锁定行为不再回归。
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/database.types";
import { maybeCompleteGeneration } from "@/lib/services/materials/generate";

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
      email: `generation-complete-${Date.now()}@example.com`,
      password: "test-password-123",
      email_confirm: true,
    });
    if (error || !user.user) throw error ?? new Error("failed to create user");
    userId = user.user.id;
    const { data: show, error: showErr } = await admin
      .from("shows")
      .insert({ user_id: userId, name: "状态迁移测试节目" })
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

async function createEpisode(generateMaterials: string[]) {
  const { data, error } = await admin
    .from("episodes")
    .insert({
      show_id: showId,
      source_type: "file",
      status: "generating",
      generate_materials: generateMaterials,
    })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("failed to create episode");
  createdEpisodeIds.push(data.id);
  return data.id;
}

async function setMaterial(
  episodeId: string,
  type: Database["public"]["Enums"]["material_type"],
  status: Database["public"]["Enums"]["material_status"],
) {
  const { error } = await admin
    .from("materials")
    .upsert({ episode_id: episodeId, type, status }, { onConflict: "episode_id,type" });
  if (error) throw error;
}

async function statusOf(episodeId: string) {
  const { data } = await admin.from("episodes").select("status").eq("id", episodeId).single();
  return data?.status;
}

describe("maybeCompleteGeneration：generating -> ready 状态迁移", () => {
  it("启用的物料全部 ready 后，episode 变成 ready", async () => {
    const id = await createEpisode(["title", "chapters"]);
    await setMaterial(id, "title", "ready");
    await setMaterial(id, "chapters", "ready");

    await maybeCompleteGeneration(admin, id);

    expect(await statusOf(id)).toBe("ready");
  });

  it("还有物料在 pending/generating 时不会提前迁移", async () => {
    const id = await createEpisode(["title", "chapters"]);
    await setMaterial(id, "title", "ready");
    await setMaterial(id, "chapters", "generating");

    await maybeCompleteGeneration(admin, id);

    expect(await statusOf(id)).toBe("generating");
  });

  it("某一项失败不会卡住整体——failed 算终态，其它都 ready 就照样迁移", async () => {
    const id = await createEpisode(["title", "chapters"]);
    await setMaterial(id, "title", "ready");
    await setMaterial(id, "chapters", "failed");

    await maybeCompleteGeneration(admin, id);

    expect(await statusOf(id)).toBe("ready");
  });

  it("shownotes 是粗粒度勾选，要展开成三个块——只做完其中一块不会提前迁移", async () => {
    const id = await createEpisode(["shownotes"]);
    await setMaterial(id, "shownotes_intro", "ready");
    await setMaterial(id, "shownotes_guest_intro", "ready");
    // shownotes_mentions 还没做

    await maybeCompleteGeneration(admin, id);

    expect(await statusOf(id)).toBe("generating");
  });

  it("shownotes 三个块都到终态后才迁移", async () => {
    const id = await createEpisode(["shownotes"]);
    await setMaterial(id, "shownotes_intro", "ready");
    await setMaterial(id, "shownotes_guest_intro", "ready");
    await setMaterial(id, "shownotes_mentions", "ready");

    await maybeCompleteGeneration(admin, id);

    expect(await statusOf(id)).toBe("ready");
  });

  it("generate_materials 里有还没实现生成器的类型（比如切片）时忽略它们，不会卡住状态机", async () => {
    const id = await createEpisode(["title", "clips"]);
    await setMaterial(id, "title", "ready");
    // clips 没有 material 行——它还没有生成器，从没被创建过

    await maybeCompleteGeneration(admin, id);

    expect(await statusOf(id)).toBe("ready");
  });

  it("不是 generating 状态的 episode 不会被处理", async () => {
    const id = await createEpisode(["title"]);
    await admin.from("episodes").update({ status: "ready" }).eq("id", id);
    await setMaterial(id, "title", "generating");

    await maybeCompleteGeneration(admin, id);

    // 还是 ready，不会因为函数跑了一遍就被错误地拽回别的状态
    expect(await statusOf(id)).toBe("ready");
  });
});
