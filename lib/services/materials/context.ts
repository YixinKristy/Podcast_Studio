import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import type { TranscriptSegment } from "@/lib/services/transcript";
import type { Guest } from "@/lib/services/episode";
import type { MaterialGenerationContext } from "./types";

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function transcriptToText(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => `[${formatTimestamp(s.start)}][说话人${s.speaker}] ${s.text}`)
    .join("\n");
}

export async function buildGenerationContext(
  supabase: SupabaseClient<Database>,
  episodeId: string,
): Promise<MaterialGenerationContext> {
  const { data: episode, error } = await supabase
    .from("episodes")
    .select("promote_note, guests, transcript, show_id")
    .eq("id", episodeId)
    .single();
  if (error || !episode) throw new Error("找不到这期节目");

  const { data: show } = await supabase
    .from("shows")
    .select("name, intro")
    .eq("id", episode.show_id)
    .single();

  const segments = (episode.transcript as unknown as TranscriptSegment[] | null) ?? [];

  return {
    episodeId,
    showName: show?.name ?? "",
    showIntro: show?.intro ?? null,
    promoteNote: episode.promote_note,
    guests: (episode.guests as unknown as Guest[] | null) ?? [],
    transcriptText: transcriptToText(segments),
    segments,
    recentTitles: await fetchRecentTitles(supabase, episode.show_id, episodeId),
  };
}

// docs/13 通用上下文块："往期标题风格样例"——同一节目其它期已确认的标题候选，
// 帮标题 prompt 延续这档节目一贯的语气（V2 风格记忆的雏形）。没有就返回空数组。
async function fetchRecentTitles(
  supabase: SupabaseClient<Database>,
  showId: string,
  excludeEpisodeId: string,
): Promise<string[]> {
  const { data: otherEpisodes } = await supabase
    .from("episodes")
    .select("id")
    .eq("show_id", showId)
    .neq("id", excludeEpisodeId);
  const otherEpisodeIds = (otherEpisodes ?? []).map((e) => e.id);
  if (otherEpisodeIds.length === 0) return [];

  const { data: pastTitles } = await supabase
    .from("materials")
    .select("content")
    .eq("type", "title")
    .not("confirmed_at", "is", null)
    .in("episode_id", otherEpisodeIds)
    .order("created_at", { ascending: false })
    .limit(3);

  return (pastTitles ?? [])
    .flatMap((m) => {
      const content = m.content as unknown as { candidates?: { title: string }[] } | null;
      return content?.candidates?.map((c) => c.title) ?? [];
    })
    .slice(0, 8);
}
