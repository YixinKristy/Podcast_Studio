"use client";

import type { Database } from "@/lib/db/database.types";
import { ContentView, MaterialTab } from "./material-tab";

type MaterialRow = Database["public"]["Tables"]["materials"]["Row"];

interface ShownotesPanelProps {
  episodeId: string;
  chaptersMaterial: MaterialRow | null;
  introMaterial: MaterialRow | null;
  pinnedQuestionMaterial: MaterialRow | null;
  guestIntroMaterial: MaterialRow | null;
  mentionsMaterial: MaterialRow | null;
}

// docs/04/05：Shownotes 是分块结构，每块独立生成/独立 reroll/独立版本历史——
// 四个真正的生成块各自复用 MaterialTab（跟标题/章节/宣传笔记走同一套契约）。
// 置顶互动问题是 docs/13 加的，05 号 PRD 原来的 5 块没有，跟 Yi 确认过补成第 6 个块。
// 时间轴章节是只读引用（改动要去 Tab4），固定尾部依赖还没做的节目设置页，先占位说明。
export function ShownotesPanel({
  episodeId,
  chaptersMaterial,
  introMaterial,
  pinnedQuestionMaterial,
  guestIntroMaterial,
  mentionsMaterial,
}: ShownotesPanelProps) {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-semibold">本期简介</h3>
        <MaterialTab episodeId={episodeId} type="shownotes_intro" material={introMaterial} />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">置顶互动问题</h3>
        <MaterialTab
          episodeId={episodeId}
          type="shownotes_pinned_question"
          material={pinnedQuestionMaterial}
        />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">时间轴章节</h3>
        {chaptersMaterial?.content ? (
          <ContentView type="chapters" content={chaptersMaterial.content} />
        ) : (
          <p className="text-muted-foreground text-sm">章节还没生成，去「章节」Tab 看看</p>
        )}
        <p className="text-muted-foreground mt-2 text-xs">只读引用，要改动去「章节」Tab</p>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">提及清单</h3>
        <MaterialTab episodeId={episodeId} type="shownotes_mentions" material={mentionsMaterial} />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold">嘉宾介绍</h3>
        <MaterialTab
          episodeId={episodeId}
          type="shownotes_guest_intro"
          material={guestIntroMaterial}
        />
      </section>

      <section>
        <h3 className="text-muted-foreground mb-2 text-sm font-semibold">固定尾部</h3>
        <p className="text-muted-foreground text-sm">
          还没做——这块要读节目级的订阅引导设置，节目设置页做完再补
        </p>
      </section>
    </div>
  );
}
