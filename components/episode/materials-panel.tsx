"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/db/supabase/client";
import type { Database } from "@/lib/db/database.types";
import { MaterialTab } from "./material-tab";

type MaterialRow = Database["public"]["Tables"]["materials"]["Row"];

const TABS: { type: "title" | "shownotes" | "chapters" | "note"; label: string }[] = [
  { type: "title", label: "标题" },
  { type: "shownotes", label: "Shownotes" },
  { type: "chapters", label: "章节" },
  { type: "note", label: "宣传笔记" },
];

interface MaterialsPanelProps {
  episodeId: string;
  enabledTypes: string[];
}

export function MaterialsPanel({ episodeId, enabledTypes }: MaterialsPanelProps) {
  const [materials, setMaterials] = useState<Record<string, MaterialRow>>({});
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]["type"]>("title");

  const tabs = TABS.filter((t) => enabledTypes.length === 0 || enabledTypes.includes(t.type));

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
    const interval = setInterval(() => {
      const anyInFlight = Object.values(materials).some(
        (m) => m.status === "pending" || m.status === "generating",
      );
      const noneYet = tabs.some((t) => !materials[t.type]);
      if (anyInFlight || noneYet) void load();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodeId]);

  if (tabs.length === 0) return null;

  return (
    <div className="mt-8">
      <h2 className="mb-3 text-lg font-semibold">发布物料</h2>
      <div className="mb-4 flex gap-2 border-b">
        {tabs.map((t) => (
          <button
            key={t.type}
            type="button"
            onClick={() => setActiveTab(t.type)}
            className={`px-3 py-2 text-sm ${
              activeTab === t.type
                ? "border-primary text-primary border-b-2 font-medium"
                : "text-muted-foreground"
            }`}
          >
            {t.label}
            {materials[t.type]?.confirmed_at && " ✓"}
          </button>
        ))}
      </div>

      {tabs.map(
        (t) =>
          activeTab === t.type && (
            <MaterialTab
              key={t.type}
              episodeId={episodeId}
              type={t.type}
              material={materials[t.type] ?? null}
            />
          ),
      )}
    </div>
  );
}
