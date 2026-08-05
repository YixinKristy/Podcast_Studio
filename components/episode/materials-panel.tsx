"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/db/supabase/client";
import type { Database } from "@/lib/db/database.types";
import { MaterialTab } from "./material-tab";
import { ShownotesPanel } from "./shownotes-panel";
import { ClipsPanel } from "./clips-panel";

type MaterialRow = Database["public"]["Tables"]["materials"]["Row"];

// Shownotes 在 UI 上还是一个 Tab，但底下是三个独立生成的物料类型（见 shownotes-panel.tsx），
// "shownotes" 这个 key 只用来做 Tab 导航，不对应 materials 表里的任何一行。
// "clips" 反过来——对应真实的一行 material，但生成方式跟其它 Tab 完全不同（见 clips-panel.tsx）。
const TABS: { key: "title" | "shownotes" | "chapters" | "note" | "clips"; label: string }[] = [
  { key: "title", label: "标题" },
  { key: "shownotes", label: "Shownotes" },
  { key: "chapters", label: "章节" },
  { key: "clips", label: "切片" },
  { key: "note", label: "宣传笔记" },
];

const SHOWNOTES_BLOCK_TYPES = [
  "shownotes_intro",
  "shownotes_guest_intro",
  "shownotes_mentions",
  "shownotes_pinned_question",
] as const;

interface MaterialsPanelProps {
  episodeId: string;
  enabledTypes: string[];
}

export function MaterialsPanel({ episodeId, enabledTypes }: MaterialsPanelProps) {
  const [materials, setMaterials] = useState<Record<string, MaterialRow>>({});
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]["key"]>("title");

  const tabs = TABS.filter((t) => enabledTypes.length === 0 || enabledTypes.includes(t.key));

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function load() {
      const { data } = await supabase.from("materials").select("*").eq("episode_id", episodeId);
      if (cancelled || !data) return;
      const byType: Record<string, MaterialRow> = {};
      for (const row of data) byType[row.type] = row;
      setMaterials(byType);
    }

    void load();
    const interval = setInterval(() => void load(), 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [episodeId]);

  if (tabs.length === 0) return null;

  function isConfirmed(key: (typeof TABS)[number]["key"]): boolean {
    if (key === "shownotes") {
      return SHOWNOTES_BLOCK_TYPES.every((type) => !!materials[type]?.confirmed_at);
    }
    return !!materials[key]?.confirmed_at;
  }

  return (
    <div>
      <h2 className="mb-3 text-lg font-semibold">发布物料</h2>
      <div className="mb-4 flex gap-2 border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setActiveTab(t.key)}
            className={`px-3 py-2 text-sm ${
              activeTab === t.key
                ? "border-primary text-primary border-b-2 font-medium"
                : "text-muted-foreground"
            }`}
          >
            {t.label}
            {isConfirmed(t.key) && " ✓"}
          </button>
        ))}
      </div>

      {activeTab === "shownotes" && (
        <ShownotesPanel
          episodeId={episodeId}
          chaptersMaterial={materials.chapters ?? null}
          introMaterial={materials.shownotes_intro ?? null}
          pinnedQuestionMaterial={materials.shownotes_pinned_question ?? null}
          guestIntroMaterial={materials.shownotes_guest_intro ?? null}
          mentionsMaterial={materials.shownotes_mentions ?? null}
        />
      )}
      {activeTab === "clips" && (
        <ClipsPanel episodeId={episodeId} material={materials.clips ?? null} />
      )}
      {activeTab !== "shownotes" && activeTab !== "clips" && (
        <MaterialTab
          episodeId={episodeId}
          type={activeTab}
          material={materials[activeTab] ?? null}
        />
      )}
    </div>
  );
}
