"use client";

import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  probeDuration,
  validateDuration,
  validateFileBasics,
  type ValidationError,
} from "@/lib/upload/validate";
import { uploadEpisodeFile, type UploadProgress } from "@/lib/upload/upload-client";

type State =
  | { phase: "idle" }
  | { phase: "validating"; fileName: string }
  | { phase: "error"; error: ValidationError }
  | { phase: "uploading"; fileName: string; progress: UploadProgress }
  | { phase: "duplicate"; createdAt: string }
  | { phase: "done" };

interface UploadZoneProps {
  onUploaded: (episodeId: string) => void;
}

export function UploadZone({ onUploaded }: UploadZoneProps) {
  const [state, setState] = useState<State>({ phase: "idle" });
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      setState({ phase: "validating", fileName: file.name });

      const basicsError = validateFileBasics(file);
      if (basicsError) {
        setState({ phase: "error", error: basicsError });
        return;
      }

      let durationSeconds: number;
      try {
        durationSeconds = await probeDuration(file);
      } catch {
        setState({
          phase: "error",
          error: { message: "文件可能损坏，读不出时长", suggestion: "请重新导出这个文件再试一次" },
        });
        return;
      }

      const durationError = validateDuration(durationSeconds);
      if (durationError) {
        setState({ phase: "error", error: durationError });
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setState({
        phase: "uploading",
        fileName: file.name,
        progress: { uploadedChunks: 0, totalChunks: 1, bytesUploaded: 0, totalBytes: file.size },
      });

      try {
        const outcome = await uploadEpisodeFile(file, {
          signal: controller.signal,
          onProgress: (progress) => setState({ phase: "uploading", fileName: file.name, progress }),
        });

        if (outcome.status === "duplicate") {
          setState({ phase: "duplicate", createdAt: outcome.createdAt });
          return;
        }

        setState({ phase: "done" });
        onUploaded(outcome.episodeId);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setState({ phase: "idle" });
          return;
        }
        setState({
          phase: "error",
          error: {
            message: err instanceof Error ? err.message : "上传失败",
            suggestion: "检查网络后重试",
          },
        });
      }
    },
    [onUploaded],
  );

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }

  function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
  }

  if (state.phase === "uploading") {
    const pct = Math.round(
      (state.progress.bytesUploaded / Math.max(1, state.progress.totalBytes)) * 100,
    );
    return (
      <div className="rounded-xl border p-8">
        <p className="truncate text-sm font-medium">{state.fileName}</p>
        <Progress value={pct} className="mt-3" />
        <div className="text-muted-foreground mt-2 flex justify-between text-xs">
          <span>{pct}%</span>
          <span>
            {(state.progress.bytesUploaded / 1024 / 1024).toFixed(0)}MB /{" "}
            {(state.progress.totalBytes / 1024 / 1024).toFixed(0)}MB
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => {
            abortRef.current?.abort();
          }}
        >
          取消
        </Button>
      </div>
    );
  }

  if (state.phase === "duplicate") {
    return (
      <div className="rounded-xl border p-8 text-center">
        <p className="font-medium">这期已经存在</p>
        <p className="text-muted-foreground mt-1 text-sm">
          创建于 {new Date(state.createdAt).toLocaleString("zh-CN")}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => setState({ phase: "idle" })}
        >
          重新选择其他文件
        </Button>
      </div>
    );
  }

  if (state.phase === "done") {
    return (
      <div className="rounded-xl border p-8 text-center">
        <p className="font-medium">上传完成</p>
      </div>
    );
  }

  return (
    <div
      className="cursor-pointer rounded-xl border-2 border-dashed p-14 text-center"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept="audio/*,video/mp4,.mp3,.m4a,.wav,.aac,.mp4"
        className="hidden"
        onChange={handlePick}
      />
      <p className="font-medium">拖拽或点选音频文件</p>
      <p className="text-muted-foreground mt-1 text-sm">mp3/m4a/wav/aac，≤2 小时且 ≤500MB</p>
      {state.phase === "validating" && (
        <p className="text-muted-foreground mt-3 text-sm">校验中：{state.fileName}</p>
      )}
      {state.phase === "error" && (
        <div className="mt-4 text-left">
          <p className="text-destructive text-sm font-medium">{state.error.message}</p>
          <p className="text-muted-foreground mt-1 text-sm">{state.error.suggestion}</p>
        </div>
      )}
    </div>
  );
}
