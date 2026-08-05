import { getSignedUploadUrl } from "@/lib/storage/oss";
import { buildEpisodeObjectKey } from "@/lib/storage/oss-keys";

// docs/05：3-5 条切片 + 最多 2 条备用 = 最多 7 条，8 个槽位留点余量。
// Trigger.dev 任务不能自己 import ali-oss 来签 URL（见 lib/storage/oss.ts 顶部注释），
// 所以这批槽位必须在 Next.js 侧（这里）提前签好，通过 payload 传给任务。
export const MAX_CLIP_SLOTS = 8;

export interface ClipUploadSlot {
  objectKey: string;
  uploadUrl: string;
}

export function buildClipUploadSlots(
  showId: string,
  expiresInSeconds = 4 * 60 * 60,
): ClipUploadSlot[] {
  return Array.from({ length: MAX_CLIP_SLOTS }, (_, i) => {
    const objectKey = buildEpisodeObjectKey(showId, `clip-${i}.mp3`);
    return { objectKey, uploadUrl: getSignedUploadUrl(objectKey, expiresInSeconds) };
  });
}
