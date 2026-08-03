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
  };
}
