import { randomUUID } from "node:crypto";

// 纯字符串处理，不依赖 ali-oss——这个文件可以放心被 Trigger.dev 任务直接 import。
// oss.ts 里但凡 import 了 ali-oss 的东西，整个文件都不能被任务 import（urllib 的
// require("proxy-agent") 打包不过去），所以这几个纯函数单独拆出来。

export function buildEpisodeObjectKey(showId: string, fileName: string): string {
  const ext = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : "";
  return `episodes/${showId}/${randomUUID()}${ext}`;
}

export function objectKeyFromUrl(url: string): string {
  const base = `https://${process.env.ALIYUN_OSS_BUCKET}.${process.env.ALIYUN_OSS_REGION}.aliyuncs.com/`;
  if (!url.startsWith(base)) {
    throw new Error(`不是这个 bucket 的 URL: ${url}`);
  }
  return url.slice(base.length);
}

// objectKeyFromUrl 的反函数——存进数据库的是不带签名的地址（跟 episodes.audio_url 一个套路），
// 播放/下载时才按需现签，不在生成阶段就把有时效性的签名 URL 存死
export function unsignedObjectUrl(objectKey: string): string {
  return `https://${process.env.ALIYUN_OSS_BUCKET}.${process.env.ALIYUN_OSS_REGION}.aliyuncs.com/${objectKey}`;
}
