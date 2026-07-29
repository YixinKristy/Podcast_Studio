import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ali-oss -> urllib 有个可选的动态 require("proxy-agent")，我们不用代理这个功能，
  // 不打包进 server bundle 就不会去解析它（比装一个用不到的依赖更干净）
  serverExternalPackages: ["ali-oss"],
};

export default nextConfig;
