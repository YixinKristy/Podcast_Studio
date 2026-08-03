import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { generateStructured } from "@/lib/ai/qwen";
import { buildGenerationContext } from "./context";
import { markFailed, markGenerating, saveNewVersion } from "./store";
import type { MaterialDefinition } from "./types";

export async function generateMaterial<T>(
  supabase: SupabaseClient<Database>,
  episodeId: string,
  definition: MaterialDefinition<T>,
  instruction?: string,
): Promise<T> {
  const materialId = await markGenerating(supabase, episodeId, definition.type);

  try {
    const context = await buildGenerationContext(supabase, episodeId);
    const { system, user } = definition.buildPrompt(context, instruction);
    let content: T = await generateStructured({ system, user, schema: definition.schema });
    if (definition.postProcess) {
      content = definition.postProcess(content, context);
    }
    await saveNewVersion(
      supabase,
      materialId,
      content,
      instruction ? "reroll" : "generated",
      instruction,
    );
    return content;
  } catch (err) {
    await markFailed(supabase, materialId);
    throw err;
  }
}
