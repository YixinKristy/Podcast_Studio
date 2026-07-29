import type { SupabaseClient } from "@supabase/supabase-js";
import { getOssClient, buildEpisodeObjectKey } from "@/lib/storage/oss";
import type { Database } from "@/lib/db/database.types";

export const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB，留够余量给 serverless 请求体上限
export const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB，见 docs/05 P2
export const MAX_DURATION_SECONDS = 2 * 60 * 60; // 2h，说话人分离限制（docs/12 ★1）
export const ACCEPTED_EXTENSIONS = ["mp3", "m4a", "wav", "aac", "mp4"]; // mp4 用于兜底 C10（视频容器）

export async function nextEpisodeNo(
  supabase: SupabaseClient<Database>,
  showId: string,
): Promise<number> {
  const { count } = await supabase
    .from("episodes")
    .select("id", { count: "exact", head: true })
    .eq("show_id", showId);
  return (count ?? 0) + 1;
}

export interface InitUploadInput {
  showId: string;
  contentHash: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export type InitUploadResult =
  | { kind: "duplicate"; episodeId: string; episodeNo: number | null; createdAt: string }
  | {
      kind: "resume";
      sessionId: string;
      uploadedPartNumbers: number[];
      chunkSize: number;
      totalChunks: number;
    }
  | { kind: "new"; sessionId: string; chunkSize: number; totalChunks: number };

// C5：hash 命中秒传；C3：同一份文件之前传到一半，恢复未完成的 session 而不是重新开始
export async function initUpload(
  supabase: SupabaseClient<Database>,
  input: InitUploadInput,
): Promise<InitUploadResult> {
  const { data: existingEpisode } = await supabase
    .from("episodes")
    .select("id, episode_no, created_at")
    .eq("show_id", input.showId)
    .eq("content_hash", input.contentHash)
    .maybeSingle();

  if (existingEpisode) {
    return {
      kind: "duplicate",
      episodeId: existingEpisode.id,
      episodeNo: existingEpisode.episode_no,
      createdAt: existingEpisode.created_at,
    };
  }

  const { data: existingSession } = await supabase
    .from("upload_sessions")
    .select("*")
    .eq("show_id", input.showId)
    .eq("content_hash", input.contentHash)
    .eq("status", "uploading")
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  const totalChunks = Math.ceil(input.fileSize / CHUNK_SIZE);

  if (existingSession) {
    const { data: parts } = await supabase
      .from("upload_parts")
      .select("part_no")
      .eq("upload_session_id", existingSession.id);
    return {
      kind: "resume",
      sessionId: existingSession.id,
      uploadedPartNumbers: (parts ?? []).map((p) => p.part_no),
      chunkSize: existingSession.chunk_size,
      totalChunks: existingSession.total_chunks,
    };
  }

  const objectKey = buildEpisodeObjectKey(input.showId, input.fileName);
  const oss = getOssClient();
  const initResult = await oss.initMultipartUpload(objectKey);

  const { data: session, error } = await supabase
    .from("upload_sessions")
    .insert({
      show_id: input.showId,
      content_hash: input.contentHash,
      file_name: input.fileName,
      file_size: input.fileSize,
      mime_type: input.mimeType,
      chunk_size: CHUNK_SIZE,
      total_chunks: totalChunks,
      oss_object_key: objectKey,
      oss_upload_id: initResult.uploadId,
    })
    .select("id")
    .single();

  if (error || !session) {
    throw new Error(error?.message ?? "创建上传会话失败");
  }

  return { kind: "new", sessionId: session.id, chunkSize: CHUNK_SIZE, totalChunks };
}

export async function uploadPart(
  supabase: SupabaseClient<Database>,
  sessionId: string,
  partNo: number,
  chunk: Buffer,
): Promise<void> {
  const { data: session, error } = await supabase
    .from("upload_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("status", "uploading")
    .single();

  if (error || !session) {
    throw new UploadSessionError("会话不存在或已失效");
  }
  if (new Date(session.expires_at) < new Date()) {
    throw new UploadSessionError("上传会话已过期（超过 24 小时），请重新选择文件上传");
  }

  const oss = getOssClient();
  const result = await oss.uploadPart(
    session.oss_object_key,
    session.oss_upload_id,
    partNo,
    chunk,
    0,
    chunk.length,
  );

  // upsert：同一分片重试上传也不会重复计数（幂等）
  await supabase
    .from("upload_parts")
    .upsert(
      { upload_session_id: sessionId, part_no: partNo, etag: result.etag },
      { onConflict: "upload_session_id,part_no" },
    );
}

export class UploadSessionError extends Error {}

export interface CompleteUploadInput {
  sessionId: string;
  showId: string;
}

export async function completeUpload(
  supabase: SupabaseClient<Database>,
  { sessionId, showId }: CompleteUploadInput,
): Promise<{ episodeId: string; objectKey: string }> {
  const { data: session, error: sessionErr } = await supabase
    .from("upload_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("status", "uploading")
    .single();

  if (sessionErr || !session) {
    throw new UploadSessionError("会话不存在或已完成");
  }

  const { data: parts, error: partsErr } = await supabase
    .from("upload_parts")
    .select("part_no, etag")
    .eq("upload_session_id", sessionId)
    .order("part_no", { ascending: true });

  if (partsErr || !parts || parts.length !== session.total_chunks) {
    throw new UploadSessionError(
      `分片没传完（已传 ${parts?.length ?? 0}/${session.total_chunks}），继续上传剩余分片`,
    );
  }

  const oss = getOssClient();
  await oss.completeMultipartUpload(
    session.oss_object_key,
    session.oss_upload_id,
    parts.map((p) => ({ number: p.part_no, etag: p.etag })),
  );

  const ossBaseUrl = `https://${process.env.ALIYUN_OSS_BUCKET}.${process.env.ALIYUN_OSS_REGION}.aliyuncs.com`;
  const episodeNo = await nextEpisodeNo(supabase, showId);

  const { data: episode, error: episodeErr } = await supabase
    .from("episodes")
    .insert({
      show_id: showId,
      source_type: "file",
      audio_url: `${ossBaseUrl}/${session.oss_object_key}`,
      status: "uploaded",
      content_hash: session.content_hash,
      episode_no: episodeNo,
    })
    .select("id")
    .single();

  if (episodeErr || !episode) {
    throw new UploadSessionError(episodeErr?.message ?? "创建 episode 失败");
  }

  await supabase.from("upload_sessions").update({ status: "completed" }).eq("id", sessionId);

  return { episodeId: episode.id, objectKey: session.oss_object_key };
}
