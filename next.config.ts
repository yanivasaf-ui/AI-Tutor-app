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
  //
  // Scoped to linux/x64 only (not the earlier "bin/**/*" wildcard) — Vercel's
  // actual runtime platform. onnxruntime-node ships darwin/win32/linux-arm64
  // binaries too that will never run here; the wildcard was bundling all of
  // them, ~210MB vs. the ~34MB linux/x64 actually needs. That's real weight
  // on every cold start of any route that calls embedText() (chat, exercise
  // generation) — flagged as a known follow-up when this was first written,
  // acted on now as part of the app's real "make it faster" pass.
  //
  // Same failure, second library (2026-09-11): @huggingface/transformers
  // also loads `sharp` at import time, and sharp 0.35 (the security bump,
  // c9321be) resolves its prebuilt binary through a computed
  // `@img/sharp-<platform>` path the tracer can't follow. The binary was
  // dropped from the function and every /api/tutor call — chat, exercises,
  // voice — 500'd at module load: "Could not load the sharp module using
  // the linux-x64 runtime". Production's /api/tutor has been down since
  // that deploy (2026-09-10 15:36). Forcing in sharp's linux-x64 binary and
  // the libvips it links against (loaded relative to the .node file) keeps
  // the security fix instead of pinning sharp back to 0.34.
  outputFileTracingIncludes: {
    "/api/**": [
      "./node_modules/onnxruntime-node/bin/napi-v6/linux/x64/**/*",
      "./node_modules/@img/sharp-linux-x64/**/*",
      "./node_modules/@img/sharp-libvips-linux-x64/**/*",
    ],
  },

};

export default nextConfig;
