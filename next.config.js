/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // @huggingface/transformers ships ONNX runtime, which pulls in .wasm and
    // webgpu bundles that webpack cannot resolve ("Can't resolve
    // 'ort-wasm-simd-threaded.asyncify.wasm'"). They are native/binary assets
    // loaded at runtime, not modules to bundle, so the package is kept external
    // and required from node_modules on the server instead.
    serverComponentsExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Belt and braces: even as an external, the tracer can try to follow
      // these optional asset paths. They are resolved by the runtime, not here.
      config.externals = [...(config.externals ?? []), "onnxruntime-node", "sharp"];
    }
    return config;
  },
};

module.exports = nextConfig;
