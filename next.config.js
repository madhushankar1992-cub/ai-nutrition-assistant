/** @type {import('next').NextConfig} */

// Retrieval embeds the query locally with bge-small (ONNX, ~130 MB of weights).
// That works in a long-running container and does NOT work in a serverless
// function: the weights cannot be loaded within the cold-start and bundle
// limits, so /api/chat on Vercel failed every retrieval with "can't reach my
// reference library".
//
// So the hosts take different jobs, which is what the deployment plan called
// for: Vercel serves the UI, and the container serves the API. When
// BACKEND_API_URL is set, Vercel proxies /api/chat to it instead of trying to
// run it. Leave it unset and the app serves its own API, which is what the
// container does.
const BACKEND_API_URL = process.env.BACKEND_API_URL?.replace(/\/$/, "");

const nextConfig = {
  experimental: {
    // @huggingface/transformers ships ONNX runtime, which pulls in .wasm and
    // webgpu bundles webpack cannot resolve. They are runtime assets, not
    // modules to bundle, so the package stays external.
    serverComponentsExternalPackages: ["@huggingface/transformers", "onnxruntime-node"],
  },

  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [...(config.externals ?? []), "onnxruntime-node", "sharp"];
    }
    return config;
  },

  async rewrites() {
    if (!BACKEND_API_URL) return [];
    return [{ source: "/api/chat", destination: `${BACKEND_API_URL}/api/chat` }];
  },
};

module.exports = nextConfig;
