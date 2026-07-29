// 秒传（C5）用的"快速哈希"：只读文件头尾各 4MB + 文件大小算 SHA-256，不读整个文件。
// 500MB 的文件如果整个算哈希，客户端会卡好几秒；这个取舍对播客音频这种场景足够用，
// 理论上存在极小概率的误判，不是加密安全用途，只是判重。
const PROBE_BYTES = 4 * 1024 * 1024;

export async function quickHash(file: File): Promise<string> {
  const head = file.slice(0, Math.min(PROBE_BYTES, file.size));
  const tailStart = Math.max(0, file.size - PROBE_BYTES);
  const tail = file.slice(tailStart, file.size);

  const [headBuf, tailBuf] = await Promise.all([head.arrayBuffer(), tail.arrayBuffer()]);
  const sizeBuf = new TextEncoder().encode(String(file.size));

  const combined = new Uint8Array(sizeBuf.length + headBuf.byteLength + tailBuf.byteLength);
  combined.set(sizeBuf, 0);
  combined.set(new Uint8Array(headBuf), sizeBuf.length);
  combined.set(new Uint8Array(tailBuf), sizeBuf.length + headBuf.byteLength);

  const digest = await crypto.subtle.digest("SHA-256", combined);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
