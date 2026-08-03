// C1：选中即前端拦截。格式/大小同步校验，时长要探测媒体元数据，是异步的。
export const ACCEPTED_EXTENSIONS = ["mp3", "m4a", "wav", "aac", "mp4"];
export const MAX_FILE_SIZE = 500 * 1024 * 1024;
export const MAX_DURATION_SECONDS = 2 * 60 * 60;

export interface ValidationError {
  message: string;
  suggestion: string;
}

export function validateFileBasics(file: File): ValidationError | null {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ACCEPTED_EXTENSIONS.includes(ext)) {
    return {
      message: `不支持 .${ext} 格式`,
      suggestion: `支持 ${ACCEPTED_EXTENSIONS.join("/")} 格式，用 ffmpeg 转一下：ffmpeg -i input.${ext} output.mp3`,
    };
  }
  if (file.size > MAX_FILE_SIZE) {
    const overMb = Math.round(file.size / 1024 / 1024);
    return {
      message: `文件 ${overMb}MB，超过 500MB 上限`,
      suggestion:
        "推荐用 Adobe Podcast 或降低比特率压缩，一行命令：ffmpeg -i input.mp3 -b:a 96k output.mp3",
    };
  }
  return null;
}

export function probeDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const media = document.createElement("audio");
    media.preload = "metadata";
    media.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(media.duration);
    };
    media.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("读不出这个文件的时长，可能已损坏"));
    };
    media.src = url;
  });
}

export function validateDuration(durationSeconds: number): ValidationError | null {
  if (durationSeconds > MAX_DURATION_SECONDS) {
    const hours = (durationSeconds / 3600).toFixed(1);
    return {
      message: `时长 ${hours} 小时，超过 2 小时上限（说话人分离的限制）`,
      suggestion: "切成多段，或用 ffmpeg 裁剪：ffmpeg -i input.mp3 -t 7200 output.mp3",
    };
  }
  return null;
}
