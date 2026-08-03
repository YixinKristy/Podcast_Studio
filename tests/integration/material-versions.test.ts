// 物料版本管理——回归测试覆盖一个真实踩过的 bug：materials.version 列默认值是 1，
// 如果直接拿它当"上一个版本号"来 +1，第一次保存就会变成 version 2，version 1 从未存在过，
// 回退时找不到。见任务开发过程中的实测记录。
import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/database.types";
import { getOrCreateMaterial, saveNewVersion, restoreVersion } from "@/lib/services/materials/store";

const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

let showId: string;
let userId: string;
const episodeIds: string[] = [];

beforeAll(async () => {
  const { data: user, error } = await admin.auth.admin.createUser({
    email: `material-version-test-${Date.now()}@example.com`,
    password: "test-password-123",
    email_confirm: true,
  });
  if (error || !user.user) throw error ?? new Error("failed to create user");
  userId = user.user.id;
  const { data: show, error: showErr } = await admin
    .from("shows")
    .insert({ user_id: userId, name: "版本测试节目" })
    .select("id")
    .single();
  if (showErr || !show) throw showErr ?? new Error("failed to create show");
  showId = show.id;
}, 30_000);

afterAll(async () => {
  if (episodeIds.length > 0) await admin.from("episodes").delete().in("id", episodeIds);
  if (userId) await admin.auth.admin.deleteUser(userId);
});

async function createEpisode() {
  const { data, error } = await admin
    .from("episodes")
    .insert({ show_id: showId, source_type: "file", status: "generating" })
    .select("id")
    .single();
  if (error || !data) throw error ?? new Error("failed to create episode");
  episodeIds.push(data.id);
  return data.id;
}

describe("物料版本管理", () => {
  it("全新物料第一次保存的版本号是 1，不是 2（回归测试）", async () => {
    const episodeId = await createEpisode();
    const materialId = await getOrCreateMaterial(admin, episodeId, "title");
    const { version } = await saveNewVersion(admin, materialId, { candidates: [] }, "generated");
    expect(version).toBe(1);

    const { data: versions } = await admin
      .from("material_versions")
      .select("version")
      .eq("material_id", materialId);
    expect(versions).toEqual([{ version: 1 }]);
  });

  it("连续保存的版本号递增，materials.content/version 跟着当前版本走", async () => {
    const episodeId = await createEpisode();
    const materialId = await getOrCreateMaterial(admin, episodeId, "note");

    await saveNewVersion(admin, materialId, { title: "v1", body: "b", hashtags: [] }, "generated");
    const { version } = await saveNewVersion(admin, materialId, { title: "v2", body: "b", hashtags: [] }, "reroll");
    expect(version).toBe(2);

    const { data: material } = await admin.from("materials").select("content, version").eq("id", materialId).single();
    expect(material?.version).toBe(2);
    expect((material?.content as { title: string }).title).toBe("v2");
  });

  it("回退到一个真实存在的旧版本能成功，回退本身也记一个新版本（不覆盖历史）", async () => {
    const episodeId = await createEpisode();
    const materialId = await getOrCreateMaterial(admin, episodeId, "note");

    await saveNewVersion(admin, materialId, { title: "v1", body: "b", hashtags: [] }, "generated");
    await saveNewVersion(admin, materialId, { title: "v2", body: "b", hashtags: [] }, "reroll");

    const { version } = await restoreVersion(admin, materialId, 1);
    expect(version).toBe(3);

    const { data: material } = await admin.from("materials").select("content").eq("id", materialId).single();
    expect((material?.content as { title: string }).title).toBe("v1");
  });

  it("超过 5 版时清理最旧的版本，只保留最近 5 个", async () => {
    const episodeId = await createEpisode();
    const materialId = await getOrCreateMaterial(admin, episodeId, "chapters");

    for (let i = 1; i <= 6; i++) {
      await saveNewVersion(admin, materialId, { chapters: [{ startSeconds: 0, title: `v${i}` }] }, "reroll");
    }

    const { data: versions } = await admin
      .from("material_versions")
      .select("version")
      .eq("material_id", materialId)
      .order("version");
    expect(versions?.map((v) => v.version)).toEqual([2, 3, 4, 5, 6]);
  });
});
