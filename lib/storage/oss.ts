import OSS from "ali-oss";

export { buildEpisodeObjectKey, objectKeyFromUrl, unsignedObjectUrl } from "./oss-keys";

let client: OSS | null = null;

// 单例：ali-oss client 内部会缓存签名相关状态，没必要每次请求都新建
export function getOssClient(): OSS {
  if (!client) {
    client = new OSS({
      region: process.env.ALIYUN_OSS_REGION!,
      accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID!,
      accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET!,
      bucket: process.env.ALIYUN_OSS_BUCKET!,
    });
  }
  return client;
}

// 给 Trigger.dev 任务用的签名 URL：那边不能直接依赖 ali-oss
// （它依赖的 urllib 里有个动态 require("proxy-agent")，esbuild 打包不过去，
// 连带这个文件里任何一个 export 都不能被任务 import——纯字符串处理挪去了 oss-keys.ts），
// 所以任务里只用 fetch 走签名 URL，OSS SDK 留在这边。
export function getSignedDownloadUrl(objectKey: string, expiresInSeconds = 3600): string {
  return getOssClient().signatureUrl(objectKey, { expires: expiresInSeconds });
}

// filename 常常带中文/emoji，纯 ASCII 的 filename= 那部分只是给不支持 filename* 的老浏览器
// 兜底，实际显示名靠 RFC 5987 的 filename*=UTF-8''...。filename 来自 LLM 生成的标题，
// 先去掉换行/分号/引号防止头注入。
export function buildContentDisposition(filename: string): string {
  const safe = filename.replace(/[\r\n;"]/g, "");
  const asciiFallback = safe.replace(/[^\x20-\x7E]/g, "_") || "download.mp3";
  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

// 给"下载"按钮用的签名 URL——跟上面播放用的那个签名 URL 的区别是带了
// content-disposition: attachment。播放用的 <audio src> 走的是媒体请求管线，不受这个
// 头影响照样能放；但 <a href download> 只有同源资源才会尊重 download 属性，OSS 是跨域的，
// 不加这个响应头点了完全没反应——用户会以为按钮坏了
export function getSignedDownloadUrlAsAttachment(
  objectKey: string,
  filename: string,
  expiresInSeconds = 3600,
): string {
  return getOssClient().signatureUrl(objectKey, {
    expires: expiresInSeconds,
    response: {
      "content-disposition": buildContentDisposition(filename),
    },
  });
}

export function getSignedUploadUrl(objectKey: string, expiresInSeconds = 3600): string {
  return getOssClient().signatureUrl(objectKey, { expires: expiresInSeconds, method: "PUT" });
}
