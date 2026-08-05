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

export function getSignedUploadUrl(objectKey: string, expiresInSeconds = 3600): string {
  return getOssClient().signatureUrl(objectKey, { expires: expiresInSeconds, method: "PUT" });
}
