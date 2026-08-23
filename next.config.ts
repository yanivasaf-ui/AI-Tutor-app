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

  // serverExternalPackages stops Next.js from mangling the require() call,
  // but Vercel's own file tracer still doesn't detect this specific native
  // binary as a dependency (it's resolved by onnxruntime-node at runtime via
  // a computed path, not a static one an analyzer can follow) and drops it
  // from the deployed function. Forcing it in explicitly here fixed a
  // production 500 ("libonnxruntime.so.1: cannot open shared object file")
  // on /api/chat. Each API route is traced into its OWN serverless bundle,
  // so this recurred on /api/exercise the moment it also called embedText()
  // — scoped to "/api/**" now instead of one route at a time, so the next
  // route that needs embeddings doesn't hit this same crash again.
  outputFileTracingIncludes: {
    "/api/**": ["./node_modules/onnxruntime-node/bin/**/*"],
  },

};

export default nextConfig;
