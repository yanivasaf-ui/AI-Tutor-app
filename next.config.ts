import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @huggingface/transformers pulls in onnxruntime-node, which ships a
  // native .so binary. Left to the default bundler, Next.js inlines/mangles
  // the module and the binary's __dirname-relative lookup breaks at runtime
  // (confirmed in production: "libonnxruntime.so.1: cannot open shared
  // object file"). Marking it external tells Next.js to leave it as a plain
  // require() instead, so Vercel's file tracing picks up the real binary
  // alongside it.
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],
};

export default nextConfig;
